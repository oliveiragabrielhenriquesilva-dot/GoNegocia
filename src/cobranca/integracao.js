// Integração da cobrança com o atendimento do Balbino Chat.
//
// Quem grava o quê:
//  - Balbino (store.js / provedor WhatsApp): contatos, conversas, mensagens, pendências. Igual ao fluxo normal.
//  - Cobrança (este módulo, data/cobranca.sqlite): vínculos conversa↔caso, casos, contatos de cobrança, títulos.
//  - Mensagem recebida reprocessada: o Balbino já ignora externalId repetido; aqui só se atualiza a próxima ação do
//    caso (operação idempotente), então reprocessar não duplica nada.
//
// A instituição de uma conversa vem da CONEXÃO (tabela conexoes) ou de uma ASSOCIAÇÃO MANUAL explícita.
// Nunca do telefone. Títulos só aparecem depois da confirmação de identidade (vinculos_conversa.verificada_em).
import { all, save, addMessage, ensureConversation, upsertWhatsAppContact, handleInboundConversationState, createPendencia, pushLog, getContactByPhone, upsertContactByPhone, markMessagesDirty, uid } from '../store.js';
import { processIncoming } from '../automation-engine.js';
import { um, varios, executar, novoId, transacao, auditar } from './db.js';
import { ErroHttp, exigirEscopo, casoVisivel, responsavelVisivel } from './escopo.js';
import { detalheCaso, exigirTrava } from './carteira.js';
import { hoje, mascararTelefone, normalizarTelefone } from './util.js';
import { ponte } from './ponte.js';

const INTERVALO_MINIMO_ATIVO = 24 * 3600_000;
export const PARECE_DEBITO = /R\$|\b\d{1,3}(\.\d{3})*,\d{2}\b|d[ée]bito|em atraso|inadimpl|mensalidade[s]? (vencida|atrasada|em aberto)|saldo devedor/i;

const tentarEscopo = (usuario, orgId, perm) => { try { return exigirEscopo(usuario, orgId, perm); } catch { return null; } };

function conversaDoBalbino(u, conversationId) {
  const c = all().conversations.find(x => x.id === String(conversationId || ''));
  if (!c || !ponte.podeVerConversa(u.balbino, c)) throw new ErroHttp(404, 'Não encontrado');
  return c;
}

// ---------- Painel "Cobrança" da conversa ----------
export function painelConversa(u, conversationId) {
  const c = conversaDoBalbino(u, conversationId);
  if (c.isGroup || c.isChannel) return { aplicavel: false, motivo: 'Grupos e canais não têm cobrança.' };
  const contato = all().contacts.find(x => x.id === c.contactId) || {};
  const mapa = um('SELECT organizacao_id, modo_envio FROM conexoes WHERE instance_id=?', c.instanceId);
  let orgIds;
  if (mapa) orgIds = [mapa.organizacao_id];
  else orgIds = varios('SELECT organizacao_id FROM vinculos_conversa WHERE instance_id=? AND contact_id=?', c.instanceId, c.contactId).map(r => r.organizacao_id);
  const instituicoes = [];
  for (const orgId of orgIds) {
    const escopo = tentarEscopo(u, orgId, 'carteira.ver');
    if (!escopo) continue; // sem acesso à cobrança desta instituição: nada é revelado
    const v = um('SELECT * FROM vinculos_conversa WHERE instance_id=? AND contact_id=? AND organizacao_id=?', c.instanceId, c.contactId, orgId);
    const verificada = Boolean(v?.verificada_em && v?.caso_id);
    let caso = null;
    if (verificada) { try { caso = detalheCaso(escopo, v.caso_id); } catch { caso = null; } }
    // Sugestão (não vínculo): responsáveis desta instituição com o mesmo telefone ou o do contato ativo.
    let sugeridos = [];
    if (!verificada) {
      if (v?.caso_id) sugeridos = varios('SELECT r.id, r.nome FROM casos c JOIN responsaveis r ON r.id=c.responsavel_id WHERE c.id=? AND c.organizacao_id=?', v.caso_id, orgId);
      else {
        const tel = normalizarTelefone(contato.phone);
        if (tel) sugeridos = varios('SELECT id, nome FROM responsaveis WHERE organizacao_id=? AND telefone=?', orgId, tel);
      }
      sugeridos = sugeridos.filter(r => { try { responsavelVisivel(escopo, r.id); return true; } catch { return false; } });
    }
    instituicoes.push({
      organizacao: { id: escopo.org.id, nome: escopo.org.nome, regra_verificacao: escopo.org.regra_verificacao },
      origem: mapa ? 'CONEXAO' : v?.origem || 'ASSOCIACAO_MANUAL',
      modo_envio: mapa?.modo_envio || null,
      verificada, verificada_em: v?.verificada_em || null,
      sugeridos,
      caso: verificada && caso ? caso : null,
      pode_trabalhar: escopo.papel === 'ADMIN' || escopo.pode('caso.trabalhar'),
    });
  }
  // Conexão sem instituição: oferece associação explícita às instituições que o usuário trabalha.
  const associaveis = mapa || orgIds.length ? [] : opcoesAssociacao(u);
  return {
    aplicavel: true, conversation_id: c.id, instance_id: c.instanceId, conexao_mapeada: Boolean(mapa),
    instituicoes, associaveis,
    sem_acesso: orgIds.length > 0 && instituicoes.length === 0,
  };
}

function opcoesAssociacao(u) {
  const orgs = u.admin ? varios('SELECT id, nome FROM organizacoes WHERE ativa=1 ORDER BY nome')
    : varios("SELECT o.id, o.nome FROM acessos a JOIN organizacoes o ON o.id=a.organizacao_id WHERE a.usuario_id=? AND o.ativa=1 AND a.papel IN ('SUPERVISOR','ATENDENTE') ORDER BY o.nome", u.id);
  return orgs;
}

// Associação explícita de uma conversa (de conexão sem instituição) a uma instituição.
export function associarConversa(u, conversationId, organizacaoId) {
  const c = conversaDoBalbino(u, conversationId);
  if (c.isGroup || c.isChannel) throw new ErroHttp(400, 'Grupos e canais não têm cobrança');
  if (um('SELECT 1 FROM conexoes WHERE instance_id=?', c.instanceId)) throw new ErroHttp(409, 'Esta conexão já define a instituição');
  const escopo = exigirEscopo(u, organizacaoId, 'caso.trabalhar');
  const vinculoExistente = um('SELECT 1 FROM vinculos_conversa WHERE instance_id=? AND contact_id=? AND organizacao_id<>?', c.instanceId, c.contactId, escopo.org.id);
  if (vinculoExistente) throw new ErroHttp(409, 'Este atendimento já está associado a outra instituição.');
  const agora = Date.now();
  executar(`INSERT INTO vinculos_conversa(id, organizacao_id, instance_id, contact_id, origem, ultima_conversation_id, criado_em, atualizado_em)
            VALUES(?,?,?,?,'ASSOCIACAO_MANUAL',?,?,?) ON CONFLICT(instance_id, contact_id, organizacao_id) DO NOTHING`,
  novoId('vin'), escopo.org.id, c.instanceId, c.contactId, c.id, agora, agora);
  auditar({ usuarioId: u.id, organizacaoId: escopo.org.id, acao: 'CONVERSA_ASSOCIADA', alvoTipo: 'conversation', alvoId: c.id });
  return { ok: true };
}

function instituicaoDaConversa(u, c, organizacaoId, perm) {
  const mapa = um('SELECT organizacao_id FROM conexoes WHERE instance_id=?', c.instanceId);
  if (mapa && mapa.organizacao_id !== organizacaoId) throw new ErroHttp(404, 'Não encontrado');
  if (!mapa && !um('SELECT 1 FROM vinculos_conversa WHERE instance_id=? AND contact_id=? AND organizacao_id=?', c.instanceId, c.contactId, organizacaoId)) {
    throw new ErroHttp(409, 'Associe a conversa a uma instituição antes', 'SEM_ASSOCIACAO');
  }
  return exigirEscopo(u, organizacaoId, perm);
}

// ---------- Confirmação de identidade ----------
export function verificarIdentidade(u, conversationId, { organizacao_id, responsavel_id, matricula }) {
  const c = conversaDoBalbino(u, conversationId);
  const escopo = instituicaoDaConversa(u, c, String(organizacao_id || ''), 'caso.trabalhar');
  const r = responsavelVisivel(escopo, responsavel_id);
  const ok = um('SELECT 1 FROM vinculos v JOIN alunos a ON a.id=v.aluno_id WHERE v.organizacao_id=? AND v.responsavel_id=? AND a.matricula=?', escopo.org.id, r.id, String(matricula || '').trim());
  if (!ok) {
    auditar({ usuarioId: u.id, organizacaoId: escopo.org.id, acao: 'VERIFICACAO_FALHOU', alvoTipo: 'conversation', alvoId: c.id });
    throw new ErroHttp(422, 'A matrícula informada não confere com os alunos deste responsável', 'VERIFICACAO_FALHOU');
  }
  return transacao(() => {
    let caso = um('SELECT id FROM casos WHERE organizacao_id=? AND responsavel_id=?', escopo.org.id, r.id);
    const agora = Date.now();
    if (!caso) {
      caso = { id: novoId('cas') };
      executar("INSERT INTO casos(id, organizacao_id, responsavel_id, status, criado_em, atualizado_em) VALUES(?,?,?,'ABERTO',?,?)", caso.id, escopo.org.id, r.id, agora, agora);
    }
    const v = um('SELECT * FROM vinculos_conversa WHERE instance_id=? AND contact_id=? AND organizacao_id=?', c.instanceId, c.contactId, escopo.org.id);
    if (v?.caso_id && v.caso_id !== caso.id) throw new ErroHttp(409, 'Este contato já está vinculado a outro responsável nesta instituição', 'CONTATO_OUTRO_CASO');
    if (v) executar('UPDATE vinculos_conversa SET caso_id=?, verificada_em=?, verificada_por=?, ultima_conversation_id=?, atualizado_em=? WHERE id=?', caso.id, agora, u.id, c.id, agora, v.id);
    else executar(`INSERT INTO vinculos_conversa(id, organizacao_id, instance_id, contact_id, caso_id, origem, verificada_em, verificada_por, ultima_conversation_id, criado_em, atualizado_em)
                   VALUES(?,?,?,?,?,'CONEXAO',?,?,?,?,?)`, novoId('vin'), escopo.org.id, c.instanceId, c.contactId, caso.id, agora, u.id, c.id, agora, agora);
    const contato = all().contacts.find(x => x.id === c.contactId);
    auditar({ usuarioId: u.id, organizacaoId: escopo.org.id, acao: 'IDENTIDADE_CONFIRMADA', alvoTipo: 'conversation', alvoId: c.id, detalhes: { caso_id: caso.id, telefone_confere: normalizarTelefone(contato?.phone) === r.telefone } });
    return { caso_id: caso.id, telefone_confere: normalizarTelefone(contato?.phone) === r.telefone };
  });
}

// ---------- Envio do Balbino: bloqueio de valores antes da confirmação ----------
// Chamado pelo servidor antes de enviar qualquer texto numa conversa. Só age em conversas com cobrança
// (conexão mapeada ou associação) que ainda não tiveram a identidade confirmada.
export function bloqueioEnvioBalbino(conversation, texto) {
  if (!conversation || conversation.isGroup || conversation.isChannel || !PARECE_DEBITO.test(String(texto || ''))) return null;
  const mapa = um('SELECT organizacao_id FROM conexoes WHERE instance_id=?', conversation.instanceId);
  const vinc = mapa
    ? varios('SELECT verificada_em FROM vinculos_conversa WHERE instance_id=? AND contact_id=? AND organizacao_id=?', conversation.instanceId, conversation.contactId, mapa.organizacao_id)
    : varios('SELECT verificada_em FROM vinculos_conversa WHERE instance_id=? AND contact_id=?', conversation.instanceId, conversation.contactId);
  if (!mapa && !vinc.length) return null;
  if (vinc.length === 1 && vinc[0].verificada_em) return null;
  return 'Confirme a identidade do responsável no painel Cobrança antes de falar de valores ou débitos.';
}

// ---------- Contato ativo: nasce do caso e abre/retoma a conversa na conexão da instituição ----------
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || '';
export function comPreposicao(nome) {
  const n = String(nome || '').trim();
  const p = n.split(/\s+/)[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (['colegio', 'instituto', 'centro', 'liceu', 'educandario', 'ginasio', 'curso', 'sistema', 'grupo', 'complexo'].includes(p)) return `do ${n}`;
  if (['escola', 'faculdade', 'universidade', 'creche', 'rede', 'associacao', 'fundacao', 'academia', 'casa'].includes(p)) return `da ${n}`;
  return `de ${n}`;
}
export function textoPrimeiroContato(resp, instituicao, atendente) {
  const r = primeiroNome(resp), a = primeiroNome(atendente);
  return `Olá${r ? `, ${r}` : ''}! Aqui é ${a || 'a equipe'}, da GO Negocia. Somos a equipe de atendimento financeiro ${comPreposicao(instituicao)}. Podemos falar com você por aqui sobre um assunto administrativo?`;
}

export function bloqueiosContatoAtivo(escopo, caso, agora = Date.now()) {
  const b = [];
  const det = detalheCaso(escopo, caso.id);
  if (caso.status !== 'ABERTO') b.push({ codigo: 'CASO_PAUSADO', texto: 'Caso pausado ou encerrado' });
  if (!det.responsavel.contato_autorizado) b.push({ codigo: 'CONTATO_NAO_AUTORIZADO', texto: 'A escola não autorizou contato por WhatsApp para este responsável' });
  if (!det.responsavel.telefone) b.push({ codigo: 'SEM_TELEFONE', texto: 'Responsável sem telefone válido' });
  if (det.totais.titulos_negociaveis === 0) b.push({ codigo: 'SEM_TITULO_NEGOCIAVEL', texto: 'Nenhum título em aberto sem pausa' });
  if (det.titulos.some(t => t.negociavel && t.alertas.some(a => a.codigo === 'DESATUALIZADO'))) b.push({ codigo: 'SALDO_DESATUALIZADO', texto: 'Saldo desatualizado — importe a carteira atualizada' });
  if (caso.retorno_combinado_em && caso.retorno_combinado_em > agora) b.push({ codigo: 'RETORNO_COMBINADO', texto: `Retorno combinado para ${new Date(caso.retorno_combinado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` });
  const ultimo = um("SELECT MAX(em) em FROM contatos WHERE caso_id=? AND organizacao_id=? AND direcao='ATIVO' AND canal='WHATSAPP'", caso.id, escopo.org.id)?.em;
  if (ultimo && agora - ultimo < INTERVALO_MINIMO_ATIVO) b.push({ codigo: 'CONTATO_RECENTE', texto: 'Já houve contato ativo por WhatsApp neste caso nas últimas 24 horas' });
  return b;
}

export async function iniciarContatoAtivo(u, organizacaoId, casoId, { instance_id } = {}) {
  const escopo = exigirEscopo(u, organizacaoId, 'conversa.enviar');
  const caso = casoVisivel(escopo, casoId);
  exigirTrava(escopo, u, caso);
  const conexoes = varios('SELECT instance_id, modo_envio FROM conexoes WHERE organizacao_id=?', escopo.org.id)
    .filter(x => ponte.podeConexao(u.balbino, x.instance_id) && ponte.conexaoExiste(x.instance_id));
  let cx;
  if (instance_id) { cx = conexoes.find(x => x.instance_id === instance_id); if (!cx) throw new ErroHttp(404, 'Conexão não encontrada nesta instituição'); }
  else if (conexoes.length === 1) cx = conexoes[0];
  else if (!conexoes.length) throw new ErroHttp(409, 'Esta instituição não tem conexão do Balbino vinculada (ou você não tem acesso a ela)', 'SEM_CONEXAO');
  else throw new ErroHttp(400, 'Escolha a conexão de envio', 'ESCOLHER_CONEXAO');
  const bloqueios = bloqueiosContatoAtivo(escopo, caso);
  if (bloqueios.length) throw Object.assign(new ErroHttp(409, bloqueios.map(x => x.texto).join(' · '), 'ENVIO_BLOQUEADO'), { extra: { bloqueios } });
  const resp = um('SELECT * FROM responsaveis WHERE id=? AND organizacao_id=?', caso.responsavel_id, escopo.org.id);

  // Contato do Balbino (único por telefone, como já é no Balbino). Não renomeia contato existente.
  let contato = getContactByPhone(resp.telefone);
  if (!contato) contato = upsertContactByPhone(resp.telefone, { name: resp.nome, source: 'Cobrança' });
  const v = um('SELECT * FROM vinculos_conversa WHERE instance_id=? AND contact_id=? AND organizacao_id=?', cx.instance_id, contato.id, escopo.org.id);
  if (v?.caso_id && v.caso_id !== caso.id) throw new ErroHttp(409, 'Este número já está vinculado a outro responsável nesta instituição; resolva com o supervisor', 'TELEFONE_EM_OUTRO_CASO');

  // Abre ou retoma a conversa na conexão da instituição; o atendente que iniciou passa a ser o responsável.
  const cv = ensureConversation(contato.id, cx.instance_id, { isGroup: false, isChannel: false, peerJid: `${resp.telefone}@s.whatsapp.net` });
  if (!cv.ownerId) { cv.ownerId = u.id; cv.status = 'OPEN'; cv.assignedAt = Date.now(); }
  save();
  const agora = Date.now();
  if (v) executar('UPDATE vinculos_conversa SET caso_id=?, ultima_conversation_id=?, atualizado_em=? WHERE id=?', caso.id, cv.id, agora, v.id);
  else executar(`INSERT INTO vinculos_conversa(id, organizacao_id, instance_id, contact_id, caso_id, origem, ultima_conversation_id, criado_em, atualizado_em)
                 VALUES(?,?,?,?,?,'CONTATO_ATIVO',?,?,?)`, novoId('vin'), escopo.org.id, cx.instance_id, contato.id, caso.id, cv.id, agora, agora);

  const texto = textoPrimeiroContato(resp.nome, escopo.org.nome, u.nome);
  let status = 'SIMULATED', externalId = null, erro = null;
  if (cx.modo_envio === 'REAL') {
    if (process.env.BALBINO_COBRANCA_ENVIO_REAL !== '1') { status = 'NOT_SENT'; erro = 'Envio real da cobrança desligado (BALBINO_COBRANCA_ENVIO_REAL)'; }
    else {
      try { const r = await ponte.enviarTexto(cx.instance_id, `${resp.telefone}@s.whatsapp.net`, texto); status = 'SENT'; externalId = r?.key?.id || null; }
      catch (e) { status = 'FAILED'; erro = e.message; } // nunca QUEUED: o Balbino reenviaria sozinho ao reconectar
    }
  }
  const m = addMessage({ conversationId: cv.id, direction: 'OUT', type: 'TEXT', body: texto, status, externalId, sendError: erro, authorId: u.id, meta: { cobranca: { caso_id: caso.id, organizacao_id: escopo.org.id, simulada: status === 'SIMULATED' } } });
  ponte.emit('message.received', { conversationId: cv.id, message: m });
  ponte.emit('conversation.updated', { conversationId: cv.id });
  executar(`INSERT INTO contatos(id, organizacao_id, caso_id, usuario_id, canal, direcao, resultado, nota, conversation_id, em) VALUES(?,?,?,?,'WHATSAPP','ATIVO','SEM_RESPOSTA',?,?,?)`,
    novoId('ctt'), escopo.org.id, caso.id, u.id, `Primeiro contato (${status === 'SIMULATED' ? 'simulado' : status.toLowerCase()})`, cv.id, agora);
  executar("UPDATE casos SET proxima_acao_em=?, proxima_acao_tipo='AGUARDAR_RESPOSTA', atendente_id=COALESCE(atendente_id, ?), atualizado_em=? WHERE id=? AND organizacao_id=?",
    hoje(agora + 86400000), u.id, agora, caso.id, escopo.org.id);
  auditar({ usuarioId: u.id, organizacaoId: escopo.org.id, acao: 'CONTATO_ATIVO_INICIADO', alvoTipo: 'caso', alvoId: caso.id, detalhes: { instance_id: cx.instance_id, conversation_id: cv.id, status, para: mascararTelefone(resp.telefone) } });
  return { conversation_id: cv.id, message_id: m.id, status, instance_id: cx.instance_id, erro };
}

// ---------- Mensagem recebida (real ou simulada) ----------
// Idempotente: pode ser chamada de novo para o mesmo evento sem efeito duplicado.
export function aoReceberMensagem(conversationId, message) {
  if (message && message.direction !== 'IN') return;
  const c = all().conversations.find(x => x.id === conversationId);
  if (!c || c.isGroup || c.isChannel) return;
  const vincs = varios('SELECT * FROM vinculos_conversa WHERE instance_id=? AND contact_id=? AND caso_id IS NOT NULL', c.instanceId, c.contactId);
  for (const v of vincs) {
    executar('UPDATE vinculos_conversa SET ultima_conversation_id=?, atualizado_em=? WHERE id=?', c.id, Date.now(), v.id);
    executar("UPDATE casos SET proxima_acao_em=?, proxima_acao_tipo='RESPONDER_MENSAGEM', atualizado_em=? WHERE id=? AND organizacao_id=? AND status='ABERTO'", hoje(), Date.now(), v.caso_id, v.organizacao_id);
  }
}

// Ambiente de teste: injeta uma mensagem recebida numa conexão TESTE pelo mesmo caminho de gravação do provedor
// (contato → conversa → estado de retorno → mensagem → automação/triagem). Respostas do bot ficam SIMULATED.
export async function simularRecebida(u, organizacaoId, { instance_id, telefone, texto, nome }) {
  const escopo = exigirEscopo(u, organizacaoId, 'teste.simular');
  const cx = um("SELECT * FROM conexoes WHERE instance_id=? AND organizacao_id=? AND modo_envio='TESTE'", String(instance_id || ''), escopo.org.id);
  if (!cx) throw new ErroHttp(404, 'Conexão de teste não encontrada nesta instituição');
  const tel = normalizarTelefone(telefone);
  if (!tel) throw new ErroHttp(400, 'Telefone inválido');
  const jid = `${tel}@s.whatsapp.net`;
  const contato = upsertWhatsAppContact({ phone: tel, whatsappJid: jid, name: String(nome || '').trim() || tel, nameSource: 'profile', instanceId: cx.instance_id });
  const cv = ensureConversation(contato.id, cx.instance_id, { isGroup: false, isChannel: false, peerJid: jid });
  handleInboundConversationState(cv, { source: 'COBRANCA_SIMULACAO' });
  const m = addMessage({ conversationId: cv.id, instanceId: cx.instance_id, direction: 'IN', type: 'TEXT', body: String(texto || '').slice(0, 4096), status: 'DELIVERED', externalId: `sim-${uid('in')}`, remoteJid: jid, meta: { simulada: true } });
  pushLog('COBRANCA_MENSAGEM_SIMULADA', { instanceId: cx.instance_id, conversationId: cv.id, messageId: m.id });
  ponte.emit('message.received', { conversationId: cv.id, message: m });
  ponte.emit('conversation.updated', { conversationId: cv.id });
  aoReceberMensagem(cv.id, m);
  // Mesma automação do recebimento real (triagem, boas-vindas). Envio do bot é simulado.
  const antes = new Set(all().messages.filter(x => x.conversationId === cv.id).map(x => x.id));
  const simula = async () => ({ key: { id: `sim-${uid('out')}` } });
  try { await processIncoming({ contact: contato, conversation: cv, text: m.body, interaction: null, sendReply: simula, sendChoice: simula }); }
  catch (e) { pushLog('COBRANCA_SIMULACAO_AUTOMACAO_ERRO', { conversationId: cv.id, error: e.message }); }
  const novas = all().messages.filter(x => x.conversationId === cv.id && !antes.has(x.id) && x.direction === 'OUT');
  for (const n of novas) n.status = 'SIMULATED';
  if (novas.length) { markMessagesDirty(novas); save(); }
  ponte.emit('conversation.updated', { conversationId: cv.id });
  auditar({ usuarioId: u.id, organizacaoId: escopo.org.id, acao: 'TESTE_MENSAGEM_SIMULADA', alvoTipo: 'conversation', alvoId: cv.id });
  return { conversation_id: cv.id, message_id: m.id, contact_id: contato.id };
}

// ---------- Pendências do Balbino ligadas ao caso ----------
const MOTIVOS = {
  CONTESTACAO: { titulo: 'Cobrança · contestação de mensalidade', pausa: 'CONTESTADO' },
  COMPROVANTE: { titulo: 'Cobrança · comprovante em análise', pausa: 'COMPROVANTE_EM_ANALISE' },
  CONDICAO_EXCECAO: { titulo: 'Cobrança · aprovação de condição fora da regra', pausa: null },
};

export function criarPendenciaCobranca(u, organizacaoId, casoId, { motivo, titulo_ids = [], descricao = '', conversation_id = null, prazo = null }) {
  const escopo = exigirEscopo(u, organizacaoId, 'caso.trabalhar');
  const caso = casoVisivel(escopo, casoId);
  const def = MOTIVOS[motivo];
  if (!def) throw new ErroHttp(400, 'Motivo inválido');
  const ids = [...new Set((Array.isArray(titulo_ids) ? titulo_ids : []).map(String))];
  const titulos = ids.map(id => um('SELECT * FROM titulos WHERE id=? AND organizacao_id=? AND responsavel_id=?', id, escopo.org.id, caso.responsavel_id));
  if (titulos.some(t => !t)) throw new ErroHttp(404, 'Título não encontrado neste caso');
  if (def.pausa && !titulos.length) throw new ErroHttp(400, 'Selecione os títulos afetados');
  // Conversa de referência: a informada (se visível e do mesmo vínculo) ou a última do caso.
  let cvId = null, contactId = null;
  if (conversation_id) {
    const c = conversaDoBalbino(u, conversation_id);
    const v = um('SELECT 1 FROM vinculos_conversa WHERE instance_id=? AND contact_id=? AND caso_id=?', c.instanceId, c.contactId, caso.id);
    if (!v) throw new ErroHttp(409, 'Esta conversa não está vinculada a este caso');
    cvId = c.id; contactId = c.contactId;
  } else {
    const v = um('SELECT * FROM vinculos_conversa WHERE caso_id=? AND organizacao_id=? ORDER BY atualizado_em DESC LIMIT 1', caso.id, escopo.org.id);
    if (!v) throw new ErroHttp(409, 'Inicie ou vincule uma conversa a este caso antes de abrir a pendência', 'SEM_CONVERSA');
    cvId = v.ultima_conversation_id; contactId = v.contact_id;
  }
  const cv = all().conversations.find(x => x.id === cvId);
  // Título e descrição da pendência sem valores: o quadro de Pendências do Balbino segue as regras de visibilidade do Balbino.
  const p = createPendencia({
    contactId, conversationId: cvId, departmentId: cv?.departmentId || null, titulo: def.titulo,
    descricao: `${escopo.org.nome} · ${titulos.length ? `títulos ${titulos.map(t => t.id_origem).join(', ')}` : 'sem título específico'}${descricao ? ` · ${String(descricao).replace(/R\$\s*[\d.,]+|\b\d{1,3}(\.\d{3})*,\d{2}\b|\b\d+[.,]\d{2}\b/g, '[valor]').slice(0, 500)}` : ''}`,
    responsavelId: u.id, prazo, origem: 'COBRANCA', createdBy: u.id,
  });
  transacao(() => {
    executar(`INSERT INTO pendencias_cobranca(pendencia_id, organizacao_id, caso_id, motivo, titulos, status_cobranca, criada_por, criada_em) VALUES(?,?,?,?,?,?,?,?)`,
      p.id, escopo.org.id, caso.id, motivo, JSON.stringify(titulos.map(t => t.id)), def.pausa ? 'TITULOS_PAUSADOS' : 'SEM_PAUSA', u.id, Date.now());
    if (def.pausa) for (const t of titulos) {
      executar('UPDATE titulos SET bloqueio=?, atualizado_em=? WHERE id=? AND organizacao_id=?', def.pausa, Date.now(), t.id, escopo.org.id);
      executar('INSERT INTO titulo_historico(organizacao_id, titulo_id, usuario_id, campo, de, para, em) VALUES(?,?,?,?,?,?,?)', escopo.org.id, t.id, u.id, 'bloqueio', t.bloqueio, def.pausa, Date.now());
    }
  });
  ponte.emit('pendencias.updated', { pendenciaId: p.id });
  auditar({ usuarioId: u.id, organizacaoId: escopo.org.id, acao: 'PENDENCIA_COBRANCA_CRIADA', alvoTipo: 'pendencia', alvoId: p.id, detalhes: { motivo, titulos: titulos.map(t => t.id_origem) } });
  return { pendencia_id: p.id, protocolo: p.protocolo };
}

export function pendenciasDoCaso(escopo, casoId) {
  const pend = all().pendencias || [];
  return varios('SELECT * FROM pendencias_cobranca WHERE caso_id=? AND organizacao_id=? ORDER BY criada_em DESC', casoId, escopo.org.id).map(r => {
    const p = pend.find(x => x.id === r.pendencia_id);
    return { pendencia_id: r.pendencia_id, protocolo: p?.protocolo || '—', status_pendencia: p?.status || 'REMOVIDA', prazo: p?.prazo || null, motivo: r.motivo, status_cobranca: r.status_cobranca, titulos: JSON.parse(r.titulos) };
  });
}

// Liberar títulos pausados é decisão da cobrança (supervisor), separada de concluir a pendência no Balbino.
export function liberarTitulosDaPendencia(u, organizacaoId, pendenciaId) {
  const escopo = exigirEscopo(u, organizacaoId, 'fila.distribuir');
  const r = um('SELECT * FROM pendencias_cobranca WHERE pendencia_id=? AND organizacao_id=?', pendenciaId, escopo.org.id);
  if (!r) throw new ErroHttp(404, 'Não encontrado');
  casoVisivel(escopo, r.caso_id);
  if (r.status_cobranca !== 'TITULOS_PAUSADOS') throw new ErroHttp(409, 'Não há títulos pausados por esta pendência');
  const def = MOTIVOS[r.motivo];
  transacao(() => {
    for (const id of JSON.parse(r.titulos)) {
      const t = um('SELECT bloqueio FROM titulos WHERE id=? AND organizacao_id=?', id, escopo.org.id);
      if (t?.bloqueio === def.pausa) {
        executar('UPDATE titulos SET bloqueio=NULL, atualizado_em=? WHERE id=? AND organizacao_id=?', Date.now(), id, escopo.org.id);
        executar('INSERT INTO titulo_historico(organizacao_id, titulo_id, usuario_id, campo, de, para, em) VALUES(?,?,?,?,?,?,?)', escopo.org.id, id, u.id, 'bloqueio', def.pausa, null, Date.now());
      }
    }
    executar("UPDATE pendencias_cobranca SET status_cobranca='TITULOS_LIBERADOS', liberada_por=?, liberada_em=? WHERE pendencia_id=?", u.id, Date.now(), pendenciaId);
  });
  auditar({ usuarioId: u.id, organizacaoId: escopo.org.id, acao: 'TITULOS_LIBERADOS', alvoTipo: 'pendencia', alvoId: pendenciaId });
  return { ok: true };
}
