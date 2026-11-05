// Importa um snapshot da GO Negocia v0.2.1 para um runtime novo e vazio.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [origem, destino] = process.argv.slice(2);
if (!origem || !destino || !path.isAbsolute(origem) || !path.isAbsolute(destino)) {
  throw new Error('Uso: npm run migrar:go -- /caminho/go-negocia.sqlite /caminho/runtime-novo');
}
const arquivo = fs.realpathSync(origem);
const final = path.resolve(destino, 'data');
if (fs.existsSync(final)) throw new Error('O destino já tem uma pasta data. Escolha um runtime novo.');
const legado = new DatabaseSync(arquivo, { readOnly: true });
legado.exec('BEGIN');
const ler = tabela => legado.prepare('SELECT * FROM ' + tabela).all();
const conexoes = ler('conexoes');
if (conexoes.some(c => c.modo === 'OFICIAL' && c.ativa)) {
  legado.close();
  throw new Error('Há uma conexão oficial ativa no banco anterior. Preserve a integração Meta antes de trocar o ambiente.');
}
const pessoas = ler('usuarios');
const administrador = pessoas.find(u => u.admin && u.ativo);
if (!administrador) {
  legado.close();
  throw new Error('O banco anterior precisa ter um administrador ativo.');
}

fs.mkdirSync(destino, { recursive: true });
const temporario = fs.mkdtempSync(path.join(destino, '.migracao-'));
process.env.BALBINO_DATA_DIR = temporario;
const tabelaUsuarios = new Map(pessoas.map(u => [u.id, u.id === administrador.id ? 'u-admin' : u.id]));
const usuarioId = id => id == null ? null : tabelaUsuarios.get(id) || id;
const lerAcessos = new Set(ler('acessos').map(a => usuarioId(a.usuario_id) + ':' + a.organizacao_id));
const tabelas = ['organizacoes', 'unidades', 'acessos', 'acesso_unidades', 'responsaveis', 'alunos', 'vinculos',
  'lotes', 'lote_linhas', 'titulos', 'titulo_historico', 'casos', 'contatos', 'auditoria'];

try {
  const chat = await import('../src/store.js');
  const { abrirBanco, fecharBanco, db, migrar, transacao, executar } = await import('../src/cobranca/db.js');
  abrirBanco(path.join(temporario, 'cobranca.sqlite'));
  migrar();

  const conversas = ler('conversas');
  const nomes = new Map();
  for (const r of ler('responsaveis')) {
    if (!r.telefone) continue;
    if (nomes.has(r.telefone) && nomes.get(r.telefone) !== r.nome) nomes.set(r.telefone, r.telefone);
    else nomes.set(r.telefone, r.nome);
  }
  const contatos = new Map();
  const conversasChat = conversas.map(c => {
    const telefone = String(c.telefone).replace(/\D/g, '');
    const contactId = 'go-legado-' + telefone;
    if (!contatos.has(telefone)) contatos.set(telefone, { id: contactId, name: nomes.get(telefone) || telefone, phone: telefone });
    return { id: c.id, protocol: c.id, contactId, instanceId: c.conexao_id, status: 'WAITING', createdAt: c.criada_em, updatedAt: c.atualizada_em };
  });
  const porConversa = new Map(conversas.map(c => [c.id, c]));
  const mensagens = ler('mensagens').map(m => ({
    id: m.id, conversationId: m.conversa_id, instanceId: porConversa.get(m.conversa_id)?.conexao_id,
    direction: m.direcao === 'ENTRADA' ? 'IN' : 'OUT', type: 'TEXT', body: m.texto,
    status: ({ RECEBIDA: 'DELIVERED', ENVIADA: 'SENT', SIMULADA: 'SIMULATED', FALHOU: 'FAILED' })[m.status] || 'NOT_SENT',
    externalId: m.id_externo, authorId: usuarioId(m.usuario_id), sendError: m.erro, createdAt: m.em,
  }));
  const conexoesChat = conexoes.map(c => ({
    id: c.id, name: c.nome, phone: '', state: 'DISCONNECTED', qr: null, lastEventAt: null, connectedAt: null,
  }));
  chat.replaceAll({
    ...chat.all(),
    users: pessoas.map(u => ({
      id: usuarioId(u.id), username: u.login, name: u.nome, role: u.admin ? 'SUPER_ADMIN' : 'AGENT',
      active: Boolean(u.ativo), status: 'OFFLINE', passwordSalt: u.senha_salt, passwordHash: u.senha_hash,
      access: { allConnections: false, connectionIds: [] },
    })).map(u => ({
      ...u,
      access: { ...u.access, connectionIds: conexoes.filter(c => lerAcessos.has(u.id + ':' + c.organizacao_id)).map(c => c.id) },
    })),
    contacts: [...contatos.values()], conversations: conversasChat, connections: conexoesChat, messages: mensagens,
    settings: { ...chat.all().settings, autoConnectWhatsApp: false },
  });
  chat.flush();
  transacao(() => {
    for (const tabela of tabelas) {
      const colunas = db().prepare('PRAGMA table_info(' + tabela + ')').all().map(c => c.name);
      const stmt = db().prepare(`INSERT INTO ${tabela}(${colunas.join(',')}) VALUES(${colunas.map(() => '?').join(',')})`);
      for (const linha of ler(tabela)) {
        stmt.run(...colunas.map(c => c.startsWith('trava_') ? null : ['usuario_id','atendente_id'].includes(c) ? usuarioId(linha[c]) : linha[c] ?? null));
      }
    }
    for (const c of conexoes) executar("INSERT INTO conexoes(instance_id,organizacao_id,modo_envio,criada_em) VALUES(?,?,'TESTE',?)", c.id, c.organizacao_id, c.criada_em);
    for (const c of conversas) {
      const contato = 'go-legado-' + String(c.telefone).replace(/\D/g, '');
      executar(`INSERT INTO vinculos_conversa(id,organizacao_id,instance_id,contact_id,caso_id,origem,verificada_em,verificada_por,ultima_conversation_id,criado_em,atualizado_em)
        VALUES(?,?,?,?,?,'CONEXAO',?,?,?,?,?)`, c.id, c.organizacao_id, c.conexao_id, contato, c.caso_id, c.verificada_em, usuarioId(c.verificada_por), c.id, c.criada_em, c.atualizada_em);
    }
    if (db().prepare('PRAGMA foreign_key_check').all().length) throw new Error('A migração gerou referências inválidas.');
  });
  fecharBanco();
  fs.renameSync(temporario, final);
  console.log(`Migração concluída: ${pessoas.length} usuários, ${ler('organizacoes').length} instituições, ${ler('titulos').length} títulos, ${conversas.length} conversas e ${mensagens.length} mensagens.`);
} finally {
  legado.close();
  fs.rmSync(temporario, { recursive: true, force: true });
}
