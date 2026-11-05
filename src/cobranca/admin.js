// Cadastro da cobrança: instituições, unidades, acessos e conexões. Exclusivo do SUPER_ADMIN do Balbino.
// Portado de GO Negocia v0.2.0 (src/admin.js) — sem cadastro de usuários: os usuários são os do Balbino.
import { um, varios, executar, novoId, transacao, auditar } from './db.js';
import { ErroHttp } from './escopo.js';

export function exigirAdmin(usuario) {
  if (!usuario) throw new ErroHttp(401, 'Sessão expirada', 'AUTH');
  if (!usuario.admin) throw new ErroHttp(403, 'Apenas o administrador do Balbino Chat', 'PERMISSAO');
}
const texto = (v, max = 120) => String(v ?? '').trim().slice(0, max);

export function listarOrganizacoes() {
  return varios(`SELECT o.*, (SELECT COUNT(*) FROM unidades u WHERE u.organizacao_id=o.id) unidades,
    (SELECT COUNT(*) FROM acessos a WHERE a.organizacao_id=o.id) usuarios,
    (SELECT COUNT(*) FROM conexoes c WHERE c.organizacao_id=o.id) conexoes
    FROM organizacoes o ORDER BY o.nome`);
}

export function criarOrganizacao(admin, b) {
  const nome = texto(b.nome);
  if (nome.length < 3) throw new ErroHttp(400, 'Informe o nome da instituição');
  const dias = Number.isInteger(b.dias_saldo_valido) && b.dias_saldo_valido > 0 && b.dias_saldo_valido <= 90 ? b.dias_saldo_valido : 7;
  const id = novoId('org');
  executar("INSERT INTO organizacoes(id, nome, tipo, regra_verificacao, dias_saldo_valido, ativa, criada_em) VALUES(?,?,'EDUCACAO','MATRICULA_ALUNO',?,1,?)", id, nome, dias, Date.now());
  auditar({ usuarioId: admin.id, organizacaoId: id, acao: 'ORGANIZACAO_CRIADA', detalhes: { nome } });
  return { id };
}

export function listarUnidades(orgId) {
  return varios('SELECT id, nome, codigo, ativa FROM unidades WHERE organizacao_id=? ORDER BY nome', orgId);
}

export function criarUnidade(admin, orgId, b) {
  if (!um('SELECT 1 FROM organizacoes WHERE id=?', orgId)) throw new ErroHttp(404, 'Não encontrado');
  const nome = texto(b.nome), codigo = texto(b.codigo, 40);
  if (!nome || !codigo) throw new ErroHttp(400, 'Informe nome e código da unidade (o código usado no arquivo da escola)');
  if (um('SELECT 1 FROM unidades WHERE organizacao_id=? AND lower(codigo)=lower(?)', orgId, codigo)) throw new ErroHttp(409, 'Já existe unidade com este código');
  const id = novoId('uni');
  executar('INSERT INTO unidades(id, organizacao_id, nome, codigo, ativa) VALUES(?,?,?,?,1)', id, orgId, nome, codigo);
  auditar({ usuarioId: admin.id, organizacaoId: orgId, acao: 'UNIDADE_CRIADA', alvoId: id, detalhes: { nome, codigo } });
  return { id };
}

export function listarAcessos(orgId) {
  const acessos = varios('SELECT usuario_id, papel, todas_unidades FROM acessos WHERE organizacao_id=?', orgId);
  const unidades = varios('SELECT usuario_id, unidade_id FROM acesso_unidades WHERE organizacao_id=?', orgId);
  return acessos.map(a => ({ ...a, todas_unidades: a.todas_unidades === 1, unidades: unidades.filter(u => u.usuario_id === a.usuario_id).map(u => u.unidade_id) }));
}

// usuarioExiste: função da ponte que confirma o ID no cadastro do Balbino.
export function definirAcesso(admin, usuarioId, orgId, { papel, unidades = null }, usuarioExiste) {
  if (!usuarioExiste(usuarioId) || !um('SELECT 1 FROM organizacoes WHERE id=?', orgId)) throw new ErroHttp(404, 'Não encontrado');
  return transacao(() => {
    executar('DELETE FROM acesso_unidades WHERE usuario_id=? AND organizacao_id=?', usuarioId, orgId);
    executar('DELETE FROM acessos WHERE usuario_id=? AND organizacao_id=?', usuarioId, orgId);
    if (papel) {
      if (!['SUPERVISOR', 'ATENDENTE', 'REPRESENTANTE'].includes(papel)) throw new ErroHttp(400, 'Perfil inválido');
      const lista = Array.isArray(unidades) && unidades.length ? unidades : null;
      if (lista) {
        const validas = new Set(varios('SELECT id FROM unidades WHERE organizacao_id=?', orgId).map(u => u.id));
        if (!lista.every(u => validas.has(u))) throw new ErroHttp(400, 'Unidade não pertence a esta instituição');
      }
      executar('INSERT INTO acessos(usuario_id, organizacao_id, papel, todas_unidades) VALUES(?,?,?,?)', usuarioId, orgId, papel, lista ? 0 : 1);
      for (const u of lista || []) executar('INSERT INTO acesso_unidades(usuario_id, organizacao_id, unidade_id) VALUES(?,?,?)', usuarioId, orgId, u);
    }
    auditar({ usuarioId: admin.id, organizacaoId: orgId, acao: papel ? 'ACESSO_DEFINIDO' : 'ACESSO_REMOVIDO', alvoTipo: 'usuario', alvoId: usuarioId, detalhes: { papel, unidades } });
    return { ok: true };
  });
}

// Conexão do Balbino -> instituição. conexaoExiste: função da ponte (connections[] do Balbino).
export function vincularConexao(admin, orgId, { instance_id, modo_envio = 'TESTE' }, conexaoExiste) {
  if (!um('SELECT 1 FROM organizacoes WHERE id=?', orgId)) throw new ErroHttp(404, 'Não encontrado');
  const inst = texto(instance_id, 80);
  if (!conexaoExiste(inst)) throw new ErroHttp(404, 'Conexão do Balbino não encontrada');
  const atual = um('SELECT organizacao_id FROM conexoes WHERE instance_id=?', inst);
  if (atual && atual.organizacao_id !== orgId) throw new ErroHttp(409, 'Esta conexão já atende outra instituição');
  if (!['TESTE', 'REAL'].includes(modo_envio)) throw new ErroHttp(400, 'Modo de envio inválido');
  executar('INSERT INTO conexoes(instance_id, organizacao_id, modo_envio, criada_em) VALUES(?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET modo_envio=excluded.modo_envio', inst, orgId, modo_envio, Date.now());
  auditar({ usuarioId: admin.id, organizacaoId: orgId, acao: 'CONEXAO_VINCULADA', alvoTipo: 'conexao', alvoId: inst, detalhes: { modo_envio } });
  return { ok: true };
}

export function desvincularConexao(admin, orgId, instanceId) {
  const r = executar('DELETE FROM conexoes WHERE instance_id=? AND organizacao_id=?', instanceId, orgId);
  if (!r.changes) throw new ErroHttp(404, 'Não encontrado');
  auditar({ usuarioId: admin.id, organizacaoId: orgId, acao: 'CONEXAO_DESVINCULADA', alvoTipo: 'conexao', alvoId: instanceId });
  return { ok: true };
}

export function conexoesDaOrg(orgId) {
  return varios('SELECT instance_id, modo_envio FROM conexoes WHERE organizacao_id=? ORDER BY instance_id', orgId);
}
