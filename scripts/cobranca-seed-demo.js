// Prepara um ambiente de TESTE do Balbino Chat com a cobrança: duas escolas fictícias, um telefone em comum.
// Uso (com o servidor PARADO e numa pasta de runtime de teste, nunca a de produção):
//   BALBINO_RUNTIME_DIR=./runtime-teste node scripts/cobranca-seed-demo.js
// Recusa rodar se a pasta já tiver conversas ou instituições (não mistura com dados reais).
import { arquivoDemo } from './cobranca-fixtures.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../src/runtime-paths.js';
import { all, save, flush } from '../src/store.js';
import { abrirBanco, migrar, um, fecharBanco } from '../src/cobranca/db.js';
import { criarOrganizacao, criarUnidade, definirAcesso, vincularConexao } from '../src/cobranca/admin.js';
import { criarPrevia, aplicarLote } from '../src/cobranca/importacao.js';
import { exigirEscopo } from '../src/cobranca/escopo.js';
import { hoje } from '../src/cobranca/util.js';

export const SENHA_DEMO = 'balbino-demo-2026';

function hashPassword(p, salt) { return crypto.scryptSync(String(p), String(salt), 32).toString('hex'); }
function usuario(id, name, username, role, connectionIds = null) {
  const salt = crypto.randomBytes(16).toString('hex');
  const u = {
    id, name, username, role, status: 'OFFLINE', departmentId: null, email: '', active: true,
    access: { allConnections: !connectionIds, connectionIds: connectionIds || [], allDepartments: true, departmentIds: [], allGroups: true, groupIds: [] },
    passwordSalt: salt, passwordHash: hashPassword(SENHA_DEMO, salt),
  };
  const i = all().users.findIndex(x => x.id === id);
  if (i >= 0) all().users[i] = { ...all().users[i], ...u }; else all().users.push(u);
}

export function popular() {
  if (process.env.NODE_ENV === 'production' || process.env.HOSTED === '1') throw new Error('A carga de demonstração só roda em ambiente de teste.');
  const db = all();
  abrirBanco(path.join(dataDir, 'cobranca.sqlite'));
  migrar();
  if (db.conversations.length || um('SELECT 1 FROM organizacoes LIMIT 1')) throw new Error('Esta pasta já tem conversas ou instituições. Use uma pasta de runtime de teste vazia.');

  // Balbino: usuários e duas conexões de teste (nunca conectadas a um número real)
  usuario('u-admin', 'Administrador', 'admin', 'SUPER_ADMIN');
  usuario('u-supervisora', 'Sílvia Supervisora', 'supervisora', 'SUPERVISOR');
  usuario('u-at-hz', 'André Atendente', 'atendente.horizonte', 'AGENT', ['hz-teste']);
  usuario('u-at-centro', 'Carla Atendente (Centro)', 'atendente.centro', 'AGENT', ['hz-teste']);
  usuario('u-at-vv', 'Bruno Atendente', 'atendente.valeverde', 'AGENT', ['vv-teste']);
  db.settings.autoConnectWhatsApp = false;
  // Identidade GO Negocia no ambiente de demonstração (cores e rodapé das mensagens do bot)
  db.settings.appearanceBrand = { defaultTheme: 'hybrid', accent: '#123E56', highlight: '#CE795F' };
  db.settings.queueRoutingFooter = 'GO Negocia';
  for (const [id, name] of [['hz-teste', 'Horizonte · teste'], ['vv-teste', 'Vale Verde · teste']]) {
    if (!db.connections.some(c => c.id === id)) db.connections.push({ id, name, phone: '', state: 'DISCONNECTED', qr: null, lastEventAt: null, connectedAt: null });
  }
  save(); flush();

  // Cobrança
  const admin = { id: 'u-admin', admin: true };
  const hz = criarOrganizacao(admin, { nome: 'Colégio Horizonte (fictício)' }).id;
  const cen = criarUnidade(admin, hz, { nome: 'Unidade Centro', codigo: 'CEN' }).id;
  criarUnidade(admin, hz, { nome: 'Unidade Jardim', codigo: 'JAR' });
  const vv = criarOrganizacao(admin, { nome: 'Escola Vale Verde (fictícia)' }).id;
  const existe = id => all().users.some(x => x.id === id);
  definirAcesso(admin, 'u-supervisora', hz, { papel: 'SUPERVISOR' }, existe);
  definirAcesso(admin, 'u-supervisora', vv, { papel: 'SUPERVISOR' }, existe);
  definirAcesso(admin, 'u-at-hz', hz, { papel: 'ATENDENTE' }, existe);
  definirAcesso(admin, 'u-at-centro', hz, { papel: 'ATENDENTE', unidades: [cen] }, existe);
  definirAcesso(admin, 'u-at-vv', vv, { papel: 'ATENDENTE' }, existe);
  const cx = id => all().connections.some(c => c.id === id);
  vincularConexao(admin, hz, { instance_id: 'hz-teste', modo_envio: 'TESTE' }, cx);
  vincularConexao(admin, vv, { instance_id: 'vv-teste', modo_envio: 'TESTE' }, cx);
  const importar = (org, arq) => {
    const escopo = exigirEscopo(admin, org);
    const p = criarPrevia({ escopo, usuario: admin, arquivoNome: arq, conteudo: arquivoDemo(arq), dataReferencia: hoje() });
    return aplicarLote({ escopo, usuario: admin, loteId: p.id }).resumo;
  };
  const resumos = { hz: importar(hz, 'carteira-colegio-horizonte.csv'), vv: importar(vv, 'carteira-escola-vale-verde.xlsx') };
  return { hz, vv, cen, resumos };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = popular();
  flush(); fecharBanco();
  console.log('Pasta de dados:', dataDir);
  console.log('Horizonte:', { novos: r.resumos.hz.novos, repetidos: r.resumos.hz.repetidos, rejeitados: r.resumos.hz.rejeitados });
  console.log('Vale Verde:', { novos: r.resumos.vv.novos, rejeitados: r.resumos.vv.rejeitados });
  console.log(`Usuários (senha ${SENHA_DEMO}): admin, supervisora, atendente.horizonte, atendente.centro, atendente.valeverde`);
  setTimeout(() => process.exit(0), 300);
}
