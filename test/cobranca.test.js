// Testes da cobrança integrada ao atendimento — servidor real (server.js) numa pasta de runtime temporária.
// Rodar: npm run test:cobranca   (de dentro de apps/chat). Nenhum WhatsApp é conectado; conexões de teste.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { arquivoDemo } from '../scripts/cobranca-fixtures.js';

const app = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cobranca-teste-'));
const porta = 3400 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${porta}`;
const SENHA = 'balbino-demo-2026';
const env = { ...process.env, NODE_ENV: 'test', HOSTED: '0', BALBINO_RUNTIME_DIR: tmp, PORT: String(porta), HOST: '127.0.0.1', COOKIE_SECURE: 'false', APP_MARCA: 'go-negocia', GOCHAT_ADMIN_PASSWORD: '' };
let srv, S = {};
const cob = () => new DatabaseSync(path.join(tmp, 'data', 'cobranca.sqlite'), { readOnly: true });

async function entrar(login) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: login, password: SENHA }) });
  assert.equal(r.status, 200, `login ${login}`);
  const ck = r.headers.get('set-cookie').split(';')[0];
  return async (m, p, b) => { const x = await fetch(base + p, { method: m, headers: { cookie: ck, ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await x.json(); } catch { /* */ } return { status: x.status, corpo: j }; };
}
const U = {};

before(async () => {
  const seed = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/cobranca-seed-demo.js'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: app, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* subindo */ } await new Promise(r => setTimeout(r, 200)); }
  for (const l of ['admin', 'supervisora', 'atendente.horizonte', 'atendente.centro', 'atendente.valeverde']) U[l] = await entrar(l);
  const eu = (await U.supervisora('GET', '/api/cobranca/eu')).corpo;
  S.hz = eu.instituicoes.find(i => i.nome.startsWith('Colégio')).organizacao_id;
  S.vv = eu.instituicoes.find(i => i.nome.startsWith('Escola')).organizacao_id;
});
after(() => { srv?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('home de apresentação separada do sistema logado, sem o nome anterior', async () => {
  const home = await (await fetch(base + '/')).text();
  assert.match(home, /<title>GO Negocia · Atendimento financeiro para escolas<\/title>/);
  assert.match(home, /Consulta de carteira/); assert.match(home, /Acordos e parcelamentos/); assert.match(home, /Em desenvolvimento/);
  assert.match(home, /href="\/app"/);
  const app = await (await fetch(base + '/app')).text();
  assert.match(app, /id="loginForm"/);
  assert.match(app, /id="cobNavModule"/);
  const js = await (await fetch(base + '/app.js')).text();
  for (const t of [home, app]) assert.doesNotMatch(t.replace(/balbino[\w:-]*/g, ''), /Balbino/, 'nenhum "Balbino" visível');
  assert.doesNotMatch(js.replace(/BalbinoApp|BalbinoCobranca|initBalbino\w*|balbino[:-][\w-]+/g, ''), /Balbino/, 'nenhum "Balbino" visível no app.js entregue');
});

test('cadastrar escola e importar carteira (admin), com reimportação sem duplicidade', async () => {
  const adm = U.admin;
  const org = await adm('POST', '/api/cobranca/admin/organizacoes', { nome: 'Escola Teste Importação' });
  assert.equal(org.status, 201);
  const csv = arquivoDemo('carteira-colegio-horizonte.csv');
  await adm('POST', `/api/cobranca/admin/organizacoes/${org.corpo.id}/unidades`, { nome: 'Centro', codigo: 'CEN' });
  await adm('POST', `/api/cobranca/admin/organizacoes/${org.corpo.id}/unidades`, { nome: 'Jardim', codigo: 'JAR' });
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const p1 = await adm('POST', `/api/cobranca/o/${org.corpo.id}/lotes`, { arquivo_nome: 'c.csv', conteudo_base64: csv.toString('base64'), data_referencia: hoje });
  assert.equal(p1.status, 201); assert.equal(p1.corpo.resumo.novos, 7); assert.equal(p1.corpo.resumo.rejeitados, 4); assert.equal(p1.corpo.resumo.repetidos, 1);
  await adm('POST', `/api/cobranca/o/${org.corpo.id}/lotes/${p1.corpo.id}/aplicar`, {});
  const conta = () => { const d = cob(); const n = d.prepare('SELECT (SELECT COUNT(*) FROM titulos WHERE organizacao_id=?) t, (SELECT COUNT(*) FROM responsaveis WHERE organizacao_id=?) r, (SELECT COUNT(*) FROM casos WHERE organizacao_id=?) c').get(org.corpo.id, org.corpo.id, org.corpo.id); d.close(); return { ...n }; };
  const antes = conta();
  const p2 = await adm('POST', `/api/cobranca/o/${org.corpo.id}/lotes`, { arquivo_nome: 'c.csv', conteudo_base64: csv.toString('base64'), data_referencia: hoje });
  assert.equal(p2.corpo.resumo.novos, 0); assert.ok(p2.corpo.resumo.arquivo_ja_aplicado_em);
  await adm('POST', `/api/cobranca/o/${org.corpo.id}/lotes/${p2.corpo.id}/aplicar`, {});
  assert.deepEqual(conta(), antes);
  // Só admin cadastra escola
  assert.equal((await U.supervisora('POST', '/api/cobranca/admin/organizacoes', { nome: 'X escola' })).status, 403);
});

test('fluxo no atendimento: mensagem na conexão da escola → sem títulos antes da confirmação → confirma → títulos', async () => {
  const sup = U.supervisora;
  const r = await sup('POST', `/api/cobranca/o/${S.hz}/teste/receber`, { instance_id: 'hz-teste', telefone: '00000000001', texto: 'Oi, quero falar da mensalidade', nome: 'Mariana' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  S.cvHz = r.corpo.conversation_id; S.contato = r.corpo.contact_id;
  // A conversa está no Atendimentos do sistema (API original) na conexão da escola
  const conv = await sup('GET', `/api/conversations/${S.cvHz}/messages`);
  assert.equal(conv.status, 200);
  const lista = await sup('GET', '/api/conversations');
  const item = (Array.isArray(lista.corpo) ? lista.corpo : lista.corpo.rows || lista.corpo.conversations || []).find(c => c.id === S.cvHz);
  assert.ok(item, 'conversa aparece na lista de Atendimentos'); assert.equal(item.instanceId, 'hz-teste');
  // Painel antes da confirmação: escola definida pela conexão, nenhum título
  const p0 = await sup('GET', `/api/cobranca/conversas/${S.cvHz}`);
  assert.equal(p0.corpo.instituicoes.length, 1);
  assert.equal(p0.corpo.instituicoes[0].organizacao.id, S.hz);
  assert.equal(p0.corpo.instituicoes[0].verificada, false);
  assert.equal(p0.corpo.instituicoes[0].caso, null);
  assert.doesNotMatch(JSON.stringify(p0.corpo), /saldo|titulos/i, 'nenhum dado financeiro antes da confirmação');
  const mariana = p0.corpo.instituicoes[0].sugeridos[0];
  assert.equal(mariana.nome, 'Demo R-501');
  // Matrícula errada
  assert.equal((await sup('POST', `/api/cobranca/conversas/${S.cvHz}/verificar`, { organizacao_id: S.hz, responsavel_id: mariana.id, matricula: 'VV-A1' })).status, 422);
  const ok = await sup('POST', `/api/cobranca/conversas/${S.cvHz}/verificar`, { organizacao_id: S.hz, responsavel_id: mariana.id, matricula: 'M-2002' });
  assert.equal(ok.status, 200);
  S.casoMariana = ok.corpo.caso_id;
  const p1 = await sup('GET', `/api/cobranca/conversas/${S.cvHz}`);
  const k = p1.corpo.instituicoes[0].caso;
  assert.equal(k.titulos.length, 3, 'títulos dos dois filhos, em unidades diferentes');
  assert.equal(k.totais.saldo_negociavel_centavos, 348000);
  assert.equal(new Set(k.alunos.map(a => a.unidade_nome)).size, 2);
});

test('mesmo telefone em duas escolas: a conexão decide; vínculos e casos separados', async () => {
  const sup = U.supervisora;
  const r = await sup('POST', `/api/cobranca/o/${S.vv}/teste/receber`, { instance_id: 'vv-teste', telefone: '00000000001', texto: 'Olá', nome: 'Paulo' });
  S.cvVv = r.corpo.conversation_id;
  assert.notEqual(S.cvVv, S.cvHz, 'outra conversa (outra conexão)');
  assert.equal(r.corpo.contact_id, S.contato, 'o contato do atendimento é o mesmo (identificado pelo telefone), a cobrança não');
  const p = await sup('GET', `/api/cobranca/conversas/${S.cvVv}`);
  assert.equal(p.corpo.instituicoes[0].organizacao.id, S.vv);
  assert.equal(p.corpo.instituicoes[0].verificada, false, 'confirmação no Horizonte não vale na Vale Verde');
  assert.deepEqual(p.corpo.instituicoes[0].sugeridos.map(x => x.nome), ['Demo VV-R1']);
  // Responsável do Horizonte não pode ser confirmado numa conversa da Vale Verde
  const mariana = cob().prepare("SELECT id FROM responsaveis WHERE chave_origem='R-501'").get().id;
  assert.equal((await sup('POST', `/api/cobranca/conversas/${S.cvVv}/verificar`, { organizacao_id: S.vv, responsavel_id: mariana, matricula: 'M-2002' })).status, 404);
  assert.equal((await sup('POST', `/api/cobranca/conversas/${S.cvVv}/verificar`, { organizacao_id: S.hz, responsavel_id: mariana, matricula: 'M-2002' })).status, 404, 'escola diferente da conexão');
});

test('bloqueio de acesso cruzado pela API (escola, unidade e permissão do atendimento)', async () => {
  const atVv = U['atendente.valeverde'], atHz = U['atendente.horizonte'], atC = U['atendente.centro'];
  assert.equal((await atVv('GET', `/api/cobranca/o/${S.hz}/carteira`)).status, 404);
  assert.equal((await atVv('GET', `/api/cobranca/o/${S.hz}/casos/${S.casoMariana}`)).status, 404);
  assert.equal((await atVv('GET', `/api/cobranca/o/${S.vv}/casos/${S.casoMariana}`)).status, 404, 'caso de outra escola pela rota da própria');
  assert.equal((await atVv('GET', `/api/cobranca/conversas/${S.cvHz}`)).status, 404, 'conversa de conexão sem permissão');
  assert.equal((await atVv('GET', `/api/conversations/${S.cvHz}/messages`)).status, 403, 'regra original do atendimento preservada');
  assert.equal((await atHz('GET', `/api/cobranca/conversas/${S.cvVv}`)).status, 404);
  assert.deepEqual((await atVv('GET', '/api/cobranca/eu')).corpo.instituicoes.map(i => i.organizacao_id), [S.vv]);
  // Restrita à unidade Centro: vê só os títulos do Centro; responsável só do Jardim não existe para ela
  const caso = await atC('GET', `/api/cobranca/o/${S.hz}/casos/${S.casoMariana}`);
  assert.ok(caso.corpo.titulos.every(t => t.unidade_nome === 'Unidade Centro'));
  const rogerio = cob().prepare("SELECT c.id FROM casos c JOIN responsaveis r ON r.id=c.responsavel_id WHERE r.chave_origem='R-504'").get().id;
  assert.equal((await atC('GET', `/api/cobranca/o/${S.hz}/casos/${rogerio}`)).status, 404);
  assert.equal((await atC('POST', `/api/cobranca/o/${S.hz}/lotes`, { arquivo_nome: 'a.csv', conteudo_base64: 'YQ==', data_referencia: '2026-01-01' })).status, 403);
  // Supervisor do atendimento que vê todas as conversas, mas só tem cobrança do Horizonte
  const novo = await U.admin('POST', '/api/users', { name: 'Supervisor só HZ', username: 'sup.hz', password: SENHA, role: 'SUPERVISOR' });
  assert.equal(novo.status, 201);
  await U.admin('PUT', `/api/cobranca/admin/organizacoes/${S.hz}/acessos/${novo.corpo.id}`, { papel: 'SUPERVISOR' });
  const supHz = await entrar('sup.hz');
  assert.equal((await supHz('GET', `/api/conversations/${S.cvVv}/messages`)).status, 403, 'sem acesso à escola, o chat também fica protegido');
  assert.equal((await supHz('GET', `/api/cobranca/conversas/${S.cvVv}`)).status, 404);
  const listaHz = (await supHz('GET', '/api/conversations')).corpo;
  assert.ok(!listaHz.some(c => c.id === S.cvVv), 'a lista do chat também respeita a escola');
});

test('atendimento original preservado: assumir, responder (simulado na conexão de teste), bloquear valores antes da confirmação', async () => {
  const atVv = U['atendente.valeverde'];
  // Triagem original do atendimento: enquanto o contato escolhe o setor, ninguém assume
  const antes = await atVv('POST', `/api/conversations/${S.cvVv}/claim`, {});
  assert.equal(antes.status, 409);
  assert.match(antes.corpo.error, /triagem/);
  await U.supervisora('POST', `/api/cobranca/o/${S.vv}/teste/receber`, { instance_id: 'vv-teste', telefone: '00000000001', texto: '1' });
  const claim = await atVv('POST', `/api/conversations/${S.cvVv}/claim`, {});
  if (claim.status !== 200) console.log('claim', claim.corpo);
  assert.equal(claim.status, 200, JSON.stringify(claim.corpo));
  const v1 = await atVv('POST', `/api/conversations/${S.cvVv}/messages`, { body: 'Seu débito é de R$ 890,00' });
  assert.equal(v1.status, 409); assert.equal(v1.corpo.codigo, 'DADOS_ANTES_DA_VERIFICACAO');
  const v2 = await atVv('POST', `/api/conversations/${S.cvVv}/messages`, { body: 'Pode me informar a matrícula de um dos alunos?' });
  assert.equal(v2.status, 200, JSON.stringify(v2.corpo));
  assert.equal(v2.corpo.messages[0].status, 'SIMULATED', 'conexão de teste nunca envia nem enfileira');
  const paulo = cob().prepare("SELECT id FROM responsaveis WHERE chave_origem='VV-R1'").get().id;
  const ver = await atVv('POST', `/api/cobranca/conversas/${S.cvVv}/verificar`, { organizacao_id: S.vv, responsavel_id: paulo, matricula: 'VV-A1' });
  assert.equal(ver.status, 200, JSON.stringify(ver.corpo));
  const v3 = await atVv('POST', `/api/conversations/${S.cvVv}/messages`, { body: 'Consta 1 mensalidade de R$ 890,00.' });
  assert.equal(v3.status, 200, JSON.stringify(v3.corpo));
  // Finalizar pelo fluxo original
  const fim = await atVv('POST', `/api/conversations/${S.cvVv}/status`, { status: 'CLOSED', reason: 'Teste', closeReason: 'Teste' });
  assert.equal(fim.status, 200, JSON.stringify(fim.corpo));
});

test('contato ativo nasce do caso, usa a conexão da escola e a resposta volta ao mesmo caso', async () => {
  const atVv = U['atendente.valeverde'];
  const helena = cob().prepare("SELECT c.id FROM casos c JOIN responsaveis r ON r.id=c.responsavel_id WHERE r.chave_origem='VV-R2'").get().id;
  assert.equal((await atVv('POST', `/api/cobranca/o/${S.vv}/casos/${helena}/contato-ativo`, {})).status, 409, 'exige assumir o caso');
  await atVv('POST', `/api/cobranca/o/${S.vv}/casos/${helena}/assumir`, {});
  assert.equal((await atVv('POST', `/api/cobranca/o/${S.vv}/casos/${helena}/contato-ativo`, { instance_id: 'hz-teste' })).status, 404, 'conexão de outra escola');
  const r = await atVv('POST', `/api/cobranca/o/${S.vv}/casos/${helena}/contato-ativo`, {});
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.instance_id, 'vv-teste'); assert.equal(r.corpo.status, 'SIMULATED');
  const msgs = (await atVv('GET', `/api/conversations/${r.corpo.conversation_id}/messages`)).corpo;
  const lista = Array.isArray(msgs) ? msgs : msgs.messages;
  const txt = lista.find(m => m.id === r.corpo.message_id).body;
  assert.equal(txt, 'Olá, Demo! Aqui é Bruno, da GO Negocia. Somos a equipe de atendimento financeiro da Escola Vale Verde (fictícia). Podemos falar com você por aqui sobre um assunto administrativo?');
  assert.doesNotMatch(txt, /Balbino|R\$/);
  assert.equal((await atVv('POST', `/api/cobranca/o/${S.vv}/casos/${helena}/contato-ativo`, {})).status, 409, 'no máximo um contato ativo por caso a cada 24h');
  // Resposta simulada na mesma conversa → mesmo caso volta para a fila de hoje
  const resp = await U.supervisora('POST', `/api/cobranca/o/${S.vv}/teste/receber`, { instance_id: 'vv-teste', telefone: '00000000002', texto: 'Oi, sou a Helena' });
  assert.equal(resp.corpo.conversation_id, r.corpo.conversation_id, 'mesma conversa');
  const d = cob(); const caso = d.prepare('SELECT proxima_acao_tipo FROM casos WHERE id=?').get(helena); d.close();
  assert.equal(caso.proxima_acao_tipo, 'RESPONDER_MENSAGEM');
  // Reprocessar o mesmo evento não duplica (o vínculo segue único)
  const d2 = cob(); assert.equal(d2.prepare('SELECT COUNT(*) n FROM vinculos_conversa WHERE caso_id=?').get(helena).n, 1); d2.close();
});

test('pendência de contestação usa as Pendências do sistema, pausa o título e concluir não libera', async () => {
  const sup = U.supervisora;
  await sup('POST', `/api/cobranca/o/${S.hz}/casos/${S.casoMariana}/assumir`, { forcar: true });
  const caso = (await sup('GET', `/api/cobranca/o/${S.hz}/casos/${S.casoMariana}`)).corpo;
  const t = caso.titulos.find(x => x.id_origem === 'HZ-1002');
  const p = await sup('POST', `/api/cobranca/o/${S.hz}/casos/${S.casoMariana}/pendencias`, { motivo: 'CONTESTACAO', titulo_ids: [t.id], descricao: 'Diz que pagou R$ 1.250,00 em setembro', conversation_id: S.cvHz });
  assert.equal(p.status, 201, JSON.stringify(p.corpo));
  const lista = (await sup('GET', '/api/pendencias')).corpo.rows;
  const pend = lista.find(x => x.protocolo === p.corpo.protocolo);
  assert.ok(pend, 'aparece no quadro de Pendências');
  assert.doesNotMatch(pend.descricao + pend.titulo, /R\$|1\.250/, 'sem valores no quadro geral');
  const depois = (await sup('GET', `/api/cobranca/o/${S.hz}/casos/${S.casoMariana}`)).corpo;
  assert.equal(depois.titulos.find(x => x.id === t.id).bloqueio, 'CONTESTADO');
  assert.equal(depois.totais.titulos_negociaveis, 2);
  // Concluir a pendência pelo fluxo original não libera nem quita
  const conc = await sup('PATCH', `/api/pendencias/${pend.id}`, { status: 'CONCLUIDA' });
  assert.equal(conc.status, 200);
  const ainda = (await sup('GET', `/api/cobranca/o/${S.hz}/casos/${S.casoMariana}`)).corpo;
  assert.equal(ainda.titulos.find(x => x.id === t.id).bloqueio, 'CONTESTADO');
  assert.equal(ainda.titulos.find(x => x.id === t.id).situacao, 'ABERTO');
  assert.equal(ainda.pendencias[0].status_pendencia, 'CONCLUIDA');
  assert.equal((await U['atendente.horizonte']('POST', `/api/cobranca/o/${S.hz}/pendencias/${pend.id}/liberar`, {})).status, 403, 'liberar é do supervisor');
  assert.equal((await sup('POST', `/api/cobranca/o/${S.hz}/pendencias/${pend.id}/liberar`, {})).status, 200);
  assert.equal((await sup('GET', `/api/cobranca/o/${S.hz}/casos/${S.casoMariana}`)).corpo.titulos.find(x => x.id === t.id).bloqueio, null);
});

test('migração da cobrança é reversível e não toca o banco do atendimento', async () => {
  const db = await import('../src/cobranca/db.js');
  const arq = path.join(tmp, 'migracao.sqlite');
  db.abrirBanco(arq);
  assert.deepEqual(db.migrar(), ['001_cobranca_base', '002_modulos_usuario']);
  assert.equal(db.reverterUltima(), '002_modulos_usuario');
  assert.equal(db.reverterUltima(), '001_cobranca_base');
  assert.equal(db.um("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='titulos'").n, 0);
  assert.deepEqual(db.migrar(), ['001_cobranca_base', '002_modulos_usuario']);
  db.fecharBanco();
  const principal = new DatabaseSync(path.join(tmp, 'data', 'balbino-chat.sqlite'), { readOnly: true });
  const tabelas = principal.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).sort();
  principal.close();
  assert.deepEqual(tabelas, ['app_state', 'messages'], 'banco principal sem tabelas da cobrança');
});

test('marca por ambiente: sem APP_MARCA o comportamento original é mantido', async () => {
  const m = await import('../src/marca.js');
  const antes = process.env.APP_MARCA;
  process.env.APP_MARCA = 'balbino';
  assert.equal(m.marcaAtual(), null); assert.equal(m.homeSeparada(), false); assert.equal(m.nomeProduto(), 'Balbino Chat');
  assert.equal(m.aplicarMarca('<title>Balbino Chat</title>', 'html'), '<title>Balbino Chat</title>');
  process.env.APP_MARCA = 'go-negocia';
  assert.equal(m.aplicarMarca('Bem-vindo ao Balbino Chat. Balbino IA. window.BalbinoApp', 'js'), 'Bem-vindo ao GO Negocia. Assistente IA. window.BalbinoApp');
  process.env.CENTRAL_BALBINO_EMBEDDED = '1';
  assert.equal(m.homeSeparada(), false, 'embutido no portal: "/" continua sendo o sistema');
  delete process.env.CENTRAL_BALBINO_EMBEDDED;
  if (antes == null) process.env.APP_MARCA = 'balbino'; else process.env.APP_MARCA = antes;
});

test('módulos por usuário: só Mensagens, só Cobrança, bloqueado no servidor', async () => {
  const adm = U.admin;
  const bal = (await adm('GET', '/api/cobranca/admin/modulos')).corpo;
  const at = bal.find(x => x.username === 'atendente.horizonte');
  assert.deepEqual(at.modulos, { atendimento: true, cobranca: true }, 'padrão: os dois liberados');
  assert.equal((await U.supervisora('PUT', `/api/cobranca/admin/modulos/${at.id}`, { atendimento: false, cobranca: true })).status, 403, 'só o administrador libera módulos');
  assert.equal((await adm('PUT', `/api/cobranca/admin/modulos/${at.id}`, { atendimento: false, cobranca: false })).status, 400);
  // Só Cobrança
  assert.equal((await adm('PUT', `/api/cobranca/admin/modulos/${at.id}`, { atendimento: false, cobranca: true })).status, 200);
  const u = U['atendente.horizonte'];
  assert.equal((await u('GET', '/api/conversations')).status, 403);
  assert.equal((await u('GET', `/api/conversations/${S.cvHz}/messages`)).status, 403);
  assert.equal((await u('GET', '/api/events')).status, 403);
  assert.equal((await u('GET', `/api/cobranca/o/${S.hz}/carteira`)).status, 200);
  const carlos = cob().prepare("SELECT c.id FROM casos c JOIN responsaveis r ON r.id=c.responsavel_id WHERE r.chave_origem='R-502'").get().id;
  await u('POST', `/api/cobranca/o/${S.hz}/casos/${carlos}/assumir`, {});
  const ativo = await u('POST', `/api/cobranca/o/${S.hz}/casos/${carlos}/contato-ativo`, {});
  assert.equal(ativo.status, 403); assert.equal(ativo.corpo.codigo, 'MODULO');
  assert.deepEqual((await u('GET', '/api/cobranca/eu')).corpo.modulos, { atendimento: false, cobranca: true });
  // Só Mensagens
  assert.equal((await adm('PUT', `/api/cobranca/admin/modulos/${at.id}`, { atendimento: true, cobranca: false })).status, 200);
  assert.equal((await u('GET', '/api/conversations')).status, 200);
  assert.equal((await u('GET', `/api/cobranca/o/${S.hz}/carteira`)).status, 403);
  assert.equal((await u('GET', `/api/cobranca/conversas/${S.cvHz}`)).status, 403);
  assert.deepEqual((await u('GET', '/api/cobranca/eu')).corpo.instituicoes, []);
  // Restaura
  assert.equal((await adm('PUT', `/api/cobranca/admin/modulos/${at.id}`, { atendimento: true, cobranca: true })).status, 200);
});
