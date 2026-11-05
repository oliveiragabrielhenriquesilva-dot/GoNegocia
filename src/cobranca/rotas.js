// Rotas HTTP da cobrança dentro do Balbino Chat: /api/cobranca/*
// O usuário é o do Balbino (sessão do Balbino). Toda rota de instituição passa por exigirEscopo() antes do handler.
import { exigirEscopo, ErroHttp, filtroUnidade, casoVisivel } from './escopo.js';
import { criarPrevia, aplicarLote, descartarLote, obterLote, listarLotes } from './importacao.js';
import { listarCarteira, resumoCarteira, detalheCaso, assumirCaso, liberarCaso, registrarContato, distribuirCaso, filaDeHoje } from './carteira.js';
import * as admin from './admin.js';
import * as integ from './integracao.js';
import { usuarioCobranca, ponte, modulosDe } from './ponte.js';
import { varios, um, executar, auditar } from './db.js';

const rotas = [];
function rota(metodo, padrao, fn) {
  const nomes = [];
  const re = new RegExp('^/api/cobranca' + padrao.replace(/:([a-z_]+)/g, (_, n) => { nomes.push(n); return '([A-Za-z0-9_.:@-]+)'; }) + '$');
  rotas.push({ metodo, re, nomes, fn });
}
const rotaOrg = (metodo, padrao, perm, fn) => rota(metodo, '/o/:org' + padrao, ctx => fn({ ...ctx, escopo: exigirEscopo(ctx.u, ctx.p.org, perm) }));
const adm = fn => ctx => { admin.exigirAdmin(ctx.u); return fn(ctx); };
const PERMS = ['carteira.ver', 'carteira.importar', 'lotes.ver', 'fila.ver', 'fila.distribuir', 'caso.trabalhar', 'conversa.ver', 'conversa.enviar', 'teste.simular'];

rota('GET', '/eu', ({ u }) => ({
  admin: u.admin,
  modulos: u.modulos,
  instituicoes: !u.modulos.cobranca ? [] : u.admin
    ? varios("SELECT id AS organizacao_id, nome, 'ADMIN' AS papel FROM organizacoes WHERE ativa=1 ORDER BY nome")
    : varios('SELECT a.organizacao_id, o.nome, a.papel FROM acessos a JOIN organizacoes o ON o.id=a.organizacao_id WHERE a.usuario_id=? AND o.ativa=1 ORDER BY o.nome', u.id),
}));

// Administração
rota('GET', '/admin/balbino', adm(() => ({ usuarios: ponte.listarUsuarios(), conexoes: ponte.listarConexoes() })));
rota('GET', '/admin/organizacoes', adm(() => admin.listarOrganizacoes()));
// Módulos por usuário: Mensagens (atendimento) e Cobrança
rota('GET', '/admin/modulos', adm(() => ponte.listarUsuarios().map(x => ({ ...x, modulos: modulosDe(x) }))));
rota('PUT', '/admin/modulos/:uid', adm(({ u, p, b }) => {
  const alvo = ponte.listarUsuarios().find(x => x.id === p.uid);
  if (!alvo) throw new ErroHttp(404, 'Não encontrado');
  if (alvo.role === 'SUPER_ADMIN') throw new ErroHttp(400, 'O administrador geral sempre tem os dois módulos');
  const at = b.atendimento ? 1 : 0, co = b.cobranca ? 1 : 0;
  if (!at && !co) throw new ErroHttp(400, 'Libere pelo menos um módulo (ou desative o usuário)');
  executar('INSERT INTO modulos_usuario(usuario_id, atendimento, cobranca, atualizado_por, atualizado_em) VALUES(?,?,?,?,?) ON CONFLICT(usuario_id) DO UPDATE SET atendimento=excluded.atendimento, cobranca=excluded.cobranca, atualizado_por=excluded.atualizado_por, atualizado_em=excluded.atualizado_em', p.uid, at, co, u.id, Date.now());
  auditar({ usuarioId: u.id, acao: 'MODULOS_USUARIO', alvoTipo: 'usuario', alvoId: p.uid, detalhes: { atendimento: at, cobranca: co } });
  return { ok: true, modulos: { atendimento: Boolean(at), cobranca: Boolean(co) } };
}));
rota('POST', '/admin/organizacoes', adm(({ u, b }) => admin.criarOrganizacao(u, b)));
rota('GET', '/admin/organizacoes/:id/unidades', adm(({ p }) => admin.listarUnidades(p.id)));
rota('POST', '/admin/organizacoes/:id/unidades', adm(({ u, p, b }) => admin.criarUnidade(u, p.id, b)));
rota('GET', '/admin/organizacoes/:id/acessos', adm(({ p }) => admin.listarAcessos(p.id)));
rota('PUT', '/admin/organizacoes/:id/acessos/:uid', adm(({ u, p, b }) => admin.definirAcesso(u, p.uid, p.id, b, ponte.usuarioExiste)));
rota('GET', '/admin/organizacoes/:id/conexoes', adm(({ p }) => admin.conexoesDaOrg(p.id)));
rota('PUT', '/admin/organizacoes/:id/conexoes/:inst', adm(({ u, p, b }) => admin.vincularConexao(u, p.id, { instance_id: p.inst, modo_envio: b.modo_envio }, ponte.conexaoExiste)));
rota('DELETE', '/admin/organizacoes/:id/conexoes/:inst', adm(({ u, p }) => admin.desvincularConexao(u, p.id, p.inst)));

// Instituição
rotaOrg('GET', '/contexto', null, ({ escopo }) => {
  const f = filtroUnidade(escopo, 'id');
  const conexoes = admin.conexoesDaOrg(escopo.org.id).filter(c => ponte.conexaoExiste(c.instance_id)).map(c => ({ ...c, nome: ponte.nomeConexao(c.instance_id) }));
  const equipe = escopo.papel === 'ADMIN' || escopo.pode('fila.distribuir')
    ? varios("SELECT usuario_id, papel FROM acessos WHERE organizacao_id=? AND papel IN ('ATENDENTE','SUPERVISOR')", escopo.org.id).map(a => ({ id: a.usuario_id, nome: ponte.nomeUsuario(a.usuario_id), papel: a.papel })) : [];
  const permissoes = PERMS.filter(p => escopo.papel === 'ADMIN' || escopo.pode(p)).filter(p => p !== 'carteira.importar' || escopo.todasUnidades);
  return {
    organizacao: { id: escopo.org.id, nome: escopo.org.nome, dias_saldo_valido: escopo.org.dias_saldo_valido },
    papel: escopo.papel, todas_unidades: escopo.todasUnidades,
    unidades: varios(`SELECT id, nome, codigo FROM unidades WHERE organizacao_id=? AND ativa=1 AND ${f.sql} ORDER BY nome`, escopo.org.id, ...f.params),
    conexoes, equipe, permissoes, resumo: resumoCarteira(escopo),
  };
});
rotaOrg('GET', '/carteira', 'carteira.ver', ({ escopo, q }) => listarCarteira(escopo, { busca: q.get('busca') || '', unidadeId: q.get('unidade') || '', pagina: q.get('pagina') || 1 }));
rotaOrg('GET', '/responsaveis/:rid/caso', 'caso.trabalhar', ({ escopo, p }) => {
  const c = um('SELECT id FROM casos WHERE organizacao_id=? AND responsavel_id=?', escopo.org.id, p.rid);
  if (!c) throw new ErroHttp(404, 'Este responsável não tem caso aberto');
  casoVisivel(escopo, c.id);
  return { caso_id: c.id };
});
const soTodas = escopo => { if (!escopo.todasUnidades) throw new ErroHttp(403, 'Importação exige acesso a todas as unidades da instituição', 'PERMISSAO'); };
rotaOrg('GET', '/lotes', 'lotes.ver', ({ escopo }) => listarLotes(escopo));
rotaOrg('POST', '/lotes', 'carteira.importar', ({ escopo, u, b }) => {
  soTodas(escopo);
  return criarPrevia({ escopo, usuario: u, arquivoNome: b.arquivo_nome, conteudo: Buffer.from(String(b.conteudo_base64 || ''), 'base64'), dataReferencia: b.data_referencia, tipo: b.tipo || 'CARTEIRA', escopoLote: b.escopo || 'COMPLETA' });
});
rotaOrg('GET', '/lotes/:id', 'lotes.ver', ({ escopo, p, q }) => obterLote(escopo, p.id, { status: q.get('status') || null }));
rotaOrg('POST', '/lotes/:id/aplicar', 'carteira.importar', ({ escopo, u, p }) => { soTodas(escopo); return aplicarLote({ escopo, usuario: u, loteId: p.id }); });
rotaOrg('POST', '/lotes/:id/descartar', 'carteira.importar', ({ escopo, u, p }) => { soTodas(escopo); return descartarLote({ escopo, usuario: u, loteId: p.id }); });
rotaOrg('GET', '/fila', 'fila.ver', ({ escopo, u, q }) => filaDeHoje(escopo, u, { unidadeId: q.get('unidade') || '', atendente: q.get('atendente') || '', atrasoMin: Number(q.get('atraso') || 0) }));
rotaOrg('GET', '/casos/:id', 'caso.trabalhar', ({ escopo, p }) => ({ ...detalheCaso(escopo, p.id), pendencias: integ.pendenciasDoCaso(escopo, p.id), bloqueios_contato_ativo: integ.bloqueiosContatoAtivo(escopo, casoVisivel(escopo, p.id)) }));
rotaOrg('POST', '/casos/:id/assumir', 'caso.trabalhar', ({ escopo, u, p, b }) => assumirCaso(escopo, u, p.id, { forcar: Boolean(b.forcar) }));
rotaOrg('POST', '/casos/:id/liberar', 'caso.trabalhar', ({ escopo, u, p }) => liberarCaso(escopo, u, p.id));
rotaOrg('POST', '/casos/:id/contatos', 'caso.trabalhar', ({ escopo, u, p, b }) => registrarContato(escopo, u, p.id, b));
rotaOrg('POST', '/casos/:id/distribuir', 'fila.distribuir', ({ escopo, u, p, b }) => distribuirCaso(escopo, u, p.id, b.atendente_id || null));
rotaOrg('POST', '/casos/:id/contato-ativo', 'conversa.enviar', ({ u, p, b }) => {
  if (!u.modulos.atendimento) throw new ErroHttp(403, 'O contato ativo abre uma conversa: libere também o módulo de Mensagens para este usuário', 'MODULO');
  return integ.iniciarContatoAtivo(u, p.org, p.id, b);
});
rotaOrg('POST', '/casos/:id/pendencias', 'caso.trabalhar', ({ u, p, b }) => integ.criarPendenciaCobranca(u, p.org, p.id, b));
rotaOrg('POST', '/pendencias/:pid/liberar', 'fila.distribuir', ({ u, p }) => integ.liberarTitulosDaPendencia(u, p.org, p.pid));
rotaOrg('POST', '/teste/receber', 'teste.simular', ({ u, p, b }) => integ.simularRecebida(u, p.org, b));

// Conversa do Balbino (painel Cobrança)
rota('GET', '/conversas/:cid', ({ u, p }) => integ.painelConversa(u, p.cid));
rota('POST', '/conversas/:cid/associar', ({ u, p, b }) => integ.associarConversa(u, p.cid, b.organizacao_id));
rota('POST', '/conversas/:cid/verificar', ({ u, p, b }) => integ.verificarIdentidade(u, p.cid, b));

// Entrada única chamada pelo servidor do Balbino. lerCorpo: função de corpo JSON do Balbino.
export async function cobrancaApi(req, res, url, usuarioBalbino, { json, lerCorpo }) {
  try {
    if (!usuarioBalbino) return json(res, 401, { error: 'AUTH_REQUIRED' });
    const u = { ...usuarioCobranca(usuarioBalbino), balbino: usuarioBalbino, modulos: modulosDe(usuarioBalbino) };
    if (!u.modulos.cobranca && url.pathname !== '/api/cobranca/eu') throw new ErroHttp(403, 'Módulo de Cobrança não liberado para este usuário', 'MODULO');
    for (const r of rotas) {
      if (r.metodo !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const p = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const b = ['POST', 'PUT', 'PATCH'].includes(req.method) ? (await lerCorpo(req, 22 * 1024 * 1024)) || {} : {};
      const out = await r.fn({ req, u, p, b, q: url.searchParams });
      return json(res, req.method === 'POST' && /\/(lotes|contatos|pendencias|contato-ativo|receber|organizacoes|unidades)$/.test(url.pathname) ? 201 : 200, out);
    }
    throw new ErroHttp(404, 'Não encontrado');
  } catch (e) {
    if (e instanceof ErroHttp) return json(res, e.status, { error: e.message, erro: e.message, codigo: e.codigo, ...(e.extra || {}) });
    if (e?.status && e.status < 500) return json(res, e.status, { error: e.message, erro: e.message });
    console.error('[cobranca]', e);
    return json(res, 500, { error: 'Erro interno na cobrança', erro: 'Erro interno na cobrança' });
  }
}
