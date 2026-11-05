// Cobrança escolar (GO Negocia) dentro do atendimento.
// Usa só a ponte window.BalbinoApp exposta no fim de app.js (api, esc, nav, selectConversation…).
// Todo dado exibido passa por esc(); toda autorização é do servidor (/api/cobranca/*).

const B = () => window.BalbinoApp;
const api = (u, o) => B().api(u, o);
const esc = s => B().esc(s ?? '');
const $ = s => document.querySelector(s);
const reais = c => c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—';
const quando = ms => ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const telBR = t => { const m = String(t || '').match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (t || ''); };
const PAPEL = { ADMIN: 'Administrador', SUPERVISOR: 'Supervisor', ATENDENTE: 'Atendente', REPRESENTANTE: 'Representante' };
const ACAO = { NOVO_CONTATO: 'Novo contato', RETORNO_COMBINADO: 'Retorno combinado', CONFERIR_PROMESSA: 'Conferir promessa', AGUARDAR_RESPOSTA: 'Aguardando resposta', RESPONDER_MENSAGEM: 'Responder mensagem' };
const RESULTADO = { SEM_RESPOSTA: 'Sem resposta', RESPONDEU: 'Respondeu', RETORNO_COMBINADO: 'Retorno combinado', PROMESSA: 'Promessa de pagamento', RECUSA: 'Recusou', NUMERO_INVALIDO: 'Número inválido', OUTRO: 'Outro' };
const MOTIVO = { CONTESTACAO: 'Contestação de mensalidade', COMPROVANTE: 'Comprovante em análise', CONDICAO_EXCECAO: 'Condição fora da regra' };
const PEND = { NOVA: 'Nova', ANDAMENTO: 'Em andamento', AGUARDANDO_ALUNO: 'Aguardando família', CONCLUIDA: 'Concluída', REMOVIDA: 'Removida' };

const cob = { eu: null, euDe: null, org: null, ctx: null, casoId: null, voltarConversa: null };
const lerOrg = () => { try { return localStorage.getItem('cob.org'); } catch { return null; } };
const gravarOrg = id => { try { localStorage.setItem('cob.org', id); } catch { /* sem armazenamento */ } };

function chip(texto, tipo = 'neutro', icone = '') { return `<span class="cob-chip ${tipo}">${icone ? icone + ' ' : ''}${esc(texto)}</span>`; }
function chipTitulo(t) {
  if (t.situacao === 'PAGO') return chip('Pago', 'ok', '✓');
  if (t.situacao === 'CANCELADO') return chip('Cancelado', 'neutro', '–');
  if (t.bloqueio === 'CONTESTADO') return chip('Contestado · pausado', 'alerta', '⏸');
  if (t.bloqueio === 'COMPROVANTE_EM_ANALISE') return chip('Comprovante em análise', 'atencao', '⏸');
  if (t.em_acordo) return chip('Em acordo', 'ok');
  if (t.ausente) return chip('Ausente na última carteira', 'atencao', '?');
  return chip('Em aberto', 'info', '●');
}
const aviso = (t, tipo = 'info') => `<div class="cob-aviso ${tipo}" role="${tipo === 'erro' ? 'alert' : 'status'}">${esc(t)}</div>`;
const msgErro = (el, e) => { if (el) el.innerHTML = aviso(e.message || String(e), 'erro') + (e.bloqueios ? `<ul class="small">${e.bloqueios.map(b => `<li>${esc(b.texto)}</li>`).join('')}</ul>` : ''); };
async function apiCob(caminho, opcoes) {
  // api() do app lança Error(data.error); reaproveita, mas preserva bloqueios quando houver
  const r = await fetch(caminho, { credentials: 'same-origin', method: opcoes?.method || 'GET', headers: opcoes?.body ? { 'Content-Type': 'application/json' } : {}, body: opcoes?.body ? JSON.stringify(opcoes.body) : undefined });
  let d = {}; try { d = await r.json(); } catch { /* vazio */ }
  if (!r.ok) throw Object.assign(new Error(d.erro || d.error || `Erro ${r.status}`), { status: r.status, bloqueios: d.bloqueios, codigo: d.codigo });
  return d;
}
const orgApi = (c, o) => apiCob(`/api/cobranca/o/${cob.org}${c}`, o);

// ---------- Menu ----------
async function carregarEu(forcar = false) {
  const me = B()?.state?.me;
  if (!me) return null;
  if (!forcar && cob.eu && cob.euDe === me.id) return cob.eu;
  cob.eu = await apiCob('/api/cobranca/eu'); cob.euDe = me.id;
  const mod = cob.eu.modulos || { atendimento: true, cobranca: true };
  // Módulo Mensagens: esconde as telas de atendimento (o servidor também bloqueia as rotas)
  for (const pg of ['inbox', 'crm', 'groups', 'scheduled', 'quickReplies', 'followups', 'knowledge', 'media', 'connections', 'flows', 'automations', 'queues', 'supervisor']) {
    const bt = document.querySelector(`.nav button[data-page="${pg}"]`);
    if (bt && !mod.atendimento) bt.classList.add('hidden');
  }
  // Grupo do menu sem nenhum item visível some junto
  if (!mod.atendimento) document.querySelectorAll('[data-nav-module]').forEach(md => { if (![...md.querySelectorAll('button[data-page]')].some(b => !b.classList.contains('hidden'))) md.classList.add('hidden'); });
  if (!mod.atendimento) setTimeout(() => { if (!document.querySelector('.page.active')?.id?.startsWith('cob')) B().nav('cobFila'); }, 300);
  const tem = mod.cobranca && (cob.eu.admin || cob.eu.instituicoes.length > 0);
  const papeis = new Set(cob.eu.instituicoes.map(i => i.papel));
  const mostra = (page, sim) => document.querySelector(`.nav button[data-page="${page}"]`)?.classList.toggle('hidden', !sim);
  $('#cobNavLabel')?.classList.toggle('hidden', !tem);
  $('#cobNavModule')?.classList.toggle('hidden', !tem);
  mostra('cobFila', cob.eu.admin || [...papeis].some(p => p !== 'REPRESENTANTE'));
  mostra('cobCarteira', tem);
  mostra('cobImportar', cob.eu.admin || papeis.has('SUPERVISOR'));
  mostra('cobEscolas', cob.eu.admin);
  mostra('cobAcordos', tem && (cob.eu.admin || papeis.has('ATENDENTE') || papeis.has('SUPERVISOR')));
  mostra('cobRetorno', tem && (cob.eu.admin || papeis.has('SUPERVISOR')));
  mostra('cobRelatorio', tem);
  const ids = cob.eu.instituicoes.map(i => i.organizacao_id);
  if (!ids.includes(cob.org)) cob.org = ids.includes(lerOrg()) ? lerOrg() : ids[0] || null;
  return cob.eu;
}
setInterval(() => { const me = B()?.state?.me; if (me && cob.euDe !== me.id) carregarEu(true).catch(() => {}); }, 1500);

async function carregarCtx() { cob.ctx = cob.org ? await orgApi('/contexto') : null; return cob.ctx; }
const pode = p => cob.ctx?.permissoes?.includes(p);

function cabecalho(titulo, sub, acoes = '') {
  const insts = cob.eu?.instituicoes || [];
  const sel = insts.length ? `<label class="small muted" for="cobOrgSel">Escola</label><select class="input cob-org-sel" id="cobOrgSel">${insts.map(i => `<option value="${esc(i.organizacao_id)}" ${i.organizacao_id === cob.org ? 'selected' : ''}>${esc(i.nome)}</option>`).join('')}</select>` : '';
  return `<div class="section-title cob-cab"><div><h2>${esc(titulo)}</h2>${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}</div><div class="cob-cab-acoes">${sel}${acoes}</div></div>`;
}
function ligarSeletor(page) {
  const s = $('#cobOrgSel');
  if (s) s.onchange = () => { cob.org = s.value; gravarOrg(s.value); carregarPagina(page); };
}

export async function carregarPagina(page) {
  const raiz = document.getElementById(`${page}Raiz`);
  if (!raiz) return;
  raiz.innerHTML = '<div class="muted">Carregando…</div>';
  try {
    await carregarEu();
    if (page === 'cobEscolas') return paginaEscolas(raiz);
    if (!cob.org) { raiz.innerHTML = cabecalho('Cobrança') + `<div class="card pad">${aviso(cob.eu?.admin ? 'Cadastre a primeira escola em Cobrança › Escolas e acessos.' : 'Você ainda não tem acesso a nenhuma escola. Peça ao administrador.')}</div>`; return; }
    await carregarCtx();
    if (page === 'cobFila') return paginaFila(raiz);
    if (page === 'cobCarteira') return paginaCarteira(raiz);
    if (page === 'cobImportar') return paginaImportar(raiz);
    if (page === 'cobCaso') return paginaCaso(raiz);
    if (page === 'cobAcordos') return paginaAcordos(raiz);
    if (page === 'cobRetorno') return paginaRetorno(raiz);
    if (page === 'cobRelatorio') return paginaRelatorio(raiz);
  } catch (e) { raiz.innerHTML = aviso(e.message, 'erro'); }
}

// ---------- Fila ----------
async function paginaFila(raiz) {
  const ctx = cob.ctx;
  const filtros = { unidade: '', atendente: ctx.papel === 'ATENDENTE' ? 'meus' : '', atraso: '' };
  const conexTeste = (ctx.conexoes || []).filter(c => c.modo_envio === 'TESTE');
  raiz.innerHTML = cabecalho('Fila de cobrança', 'Casos com próxima ação até hoje, sem retorno combinado pendente e com título negociável.') +
    `<div class="cob-filtros">
      ${ctx.unidades.length > 1 ? `<select class="input" id="cfUn" aria-label="Unidade"><option value="">Todas as unidades</option>${ctx.unidades.map(u => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('')}</select>` : ''}
      <select class="input" id="cfAt" aria-label="Atendente"><option value="">Todos os atendentes</option><option value="meus" ${filtros.atendente === 'meus' ? 'selected' : ''}>Meus e sem atendente</option><option value="sem">Sem atendente</option>${ctx.equipe.map(u => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('')}</select>
      <select class="input" id="cfAtr" aria-label="Atraso"><option value="">Qualquer atraso</option>${[15, 30, 60, 90].map(d => `<option value="${d}">${d}+ dias</option>`).join('')}</select>
    </div><div class="card pad" id="cfLista"><div class="muted">Carregando…</div></div>
    ${pode('teste.simular') && conexTeste.length ? `<details class="card pad cob-teste"><summary>Ambiente de teste: simular mensagem recebida</summary>
      <div class="cob-form-linha"><select class="input" id="csCx">${conexTeste.map(c => `<option value="${esc(c.instance_id)}">${esc(c.nome)}</option>`).join('')}</select>
      <input class="input" id="csTel" placeholder="Telefone (ex.: 16 99000-0001)"><input class="input" id="csNome" placeholder="Nome no WhatsApp (opcional)">
      <input class="input" id="csTxt" placeholder="Mensagem" value="Oi, recebi uma mensagem de vocês."><button class="btn" id="csEnviar">Simular</button></div><div id="csMsg"></div>
      <div class="small muted">Passa pelo mesmo caminho de gravação do recebimento real (contato, conversa, triagem). Respostas automáticas ficam marcadas como simuladas.</div></details>` : ''}`;
  ligarSeletor('cobFila');
  const carregar = async () => {
    const el = $('#cfLista');
    try {
      const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
      const f = await orgApi(`/fila?${q}`);
      const badge = $('#navCobFila'); if (badge) { badge.textContent = f.total; badge.style.display = f.total ? '' : 'none'; }
      el.innerHTML = f.itens.length ? `<table class="cob-tabela"><thead><tr><th>Responsável</th><th class="num">Saldo negociável</th><th class="num">Atraso</th><th>Próxima ação</th><th>Atendente</th><th>Situação</th></tr></thead><tbody>${f.itens.map(i => `
        <tr class="cob-clicavel" tabindex="0" data-caso="${esc(i.caso_id)}"><td><b>${esc(i.responsavel)}</b><div class="small muted">${i.titulos} título(s) · ${esc(i.telefone_mascarado || 'sem telefone')}</div></td>
        <td class="num">${reais(i.saldo_negociavel_centavos)}</td><td class="num">${i.dias_atraso} dias</td>
        <td>${i.proxima_acao.em ? `${dataBR(i.proxima_acao.em)}<div class="small muted">${esc(ACAO[i.proxima_acao.tipo] || i.proxima_acao.tipo || '')}</div>` : chip('Primeiro contato', 'info', '★')}</td>
        <td>${esc(i.atendente?.nome || 'Sem atendente')}</td>
        <td>${i.em_uso_por ? chip(`Em uso por ${i.em_uso_por}`, 'atencao', '⏳') : ''} ${!i.contato_autorizado ? chip('Contato não autorizado', 'alerta', '⛔') : ''} ${i.saldo_desatualizado ? chip('Saldo desatualizado', 'atencao', '⏱') : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="cob-vazio"><b>Nada na fila de hoje</b><div class="muted">Os casos têm próxima ação futura, retorno combinado ou títulos pausados.</div></div>';
      el.querySelectorAll('[data-caso]').forEach(tr => { const abre = () => abrirCaso(tr.dataset.caso, null); tr.onclick = abre; tr.onkeydown = e => { if (e.key === 'Enter') abre(); }; });
    } catch (e) { msgErro(el, e); }
  };
  $('#cfUn') && ($('#cfUn').onchange = e => { filtros.unidade = e.target.value; carregar(); });
  $('#cfAt').onchange = e => { filtros.atendente = e.target.value; carregar(); };
  $('#cfAtr').onchange = e => { filtros.atraso = e.target.value; carregar(); };
  if ($('#csEnviar')) $('#csEnviar').onclick = async () => {
    try {
      const r = await orgApi('/teste/receber', { method: 'POST', body: { instance_id: $('#csCx').value, telefone: $('#csTel').value, texto: $('#csTxt').value, nome: $('#csNome').value } });
      B().toast('Mensagem simulada recebida'); await B().abrirConversa(r.conversation_id);
    } catch (e) { msgErro($('#csMsg'), e); }
  };
  carregar();
}

// ---------- Carteira ----------
async function paginaCarteira(raiz) {
  const ctx = cob.ctx, r = ctx.resumo;
  const filtros = { busca: '', unidade: '', pagina: 1 };
  const desatual = r.referencia_mais_antiga && (Date.parse(hojeISO()) - Date.parse(r.referencia_mais_antiga)) / 86400000 > ctx.organizacao.dias_saldo_valido;
  raiz.innerHTML = cabecalho('Carteira', `${ctx.organizacao.nome} · consulta dos responsáveis, alunos e títulos`, pode('carteira.importar') ? '<button class="btn primary" id="ccImp">⇪ Importar carteira</button>' : '') +
    `<div class="cob-indicadores">
      <div class="card pad"><span>Saldo em aberto</span><b>${reais(r.saldo_aberto_centavos)}</b><small>${r.titulos_abertos} títulos</small></div>
      <div class="card pad"><span>Responsáveis</span><b>${r.responsaveis}</b><small>com título em aberto</small></div>
      <div class="card pad"><span>Saldo atualizado em</span><b>${dataBR(r.referencia_mais_recente)}</b><small>data de referência do arquivo</small></div>
      <div class="card pad"><span>Títulos com alerta</span><b>${r.titulos_com_alerta}</b><small>pausados ou ausentes da carteira</small></div>
    </div>${desatual ? aviso(`Há saldos com mais de ${ctx.organizacao.dias_saldo_valido} dias. O contato ativo fica bloqueado nesses casos até a carteira ser atualizada.`, 'atencao') : ''}
    <div class="cob-filtros"><input class="input" id="ccBusca" type="search" placeholder="Buscar por nome, código, matrícula ou telefone">
      ${ctx.unidades.length > 1 ? `<select class="input" id="ccUn" aria-label="Unidade"><option value="">Todas as unidades</option>${ctx.unidades.map(u => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('')}</select>` : ''}</div>
    <div class="card pad" id="ccLista"><div class="muted">Carregando…</div></div>`;
  ligarSeletor('cobCarteira');
  if ($('#ccImp')) $('#ccImp').onclick = () => B().nav('cobImportar');
  const carregar = async () => {
    const el = $('#ccLista');
    try {
      const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
      const c = await orgApi(`/carteira?${q}`);
      const abre = pode('caso.trabalhar');
      el.innerHTML = c.itens.length ? `<table class="cob-tabela"><thead><tr><th>Responsável</th><th>Código</th><th class="num">Títulos em aberto</th><th class="num">Saldo em aberto</th><th class="num">Atraso</th><th>Situação</th></tr></thead><tbody>${c.itens.map(i => `
        <tr ${abre ? `class="cob-clicavel" tabindex="0" data-resp="${esc(i.id)}"` : ''}><td><b>${esc(i.nome)}</b><div class="small muted">${esc(telBR(i.telefone) || 'sem telefone')}${i.documento_final ? ' · doc ' + esc(i.documento_final) : ''}</div></td>
        <td>${esc(i.chave_origem)}</td><td class="num">${i.titulos_abertos}</td><td class="num">${reais(i.saldo_aberto_centavos)}</td><td class="num">${i.dias_atraso} dias</td>
        <td>${i.titulos_com_alerta ? chip(`${i.titulos_com_alerta} com alerta`, 'atencao', '⚠') : chip('Regular', 'info', '●')} ${i.saldo_desatualizado ? chip('Saldo desatualizado', 'atencao', '⏱') : ''} ${!i.contato_autorizado ? chip('Sem autorização de contato', 'neutro', '⛔') : ''}</td></tr>`).join('')}</tbody></table>
        <div class="small muted cob-paginacao">${c.total} responsável(is) ${c.total > c.por_pagina ? `<button class="btn small" id="ccAnt" ${filtros.pagina <= 1 ? 'disabled' : ''}>‹</button><button class="btn small" id="ccProx" ${filtros.pagina * c.por_pagina >= c.total ? 'disabled' : ''}>›</button>` : ''}</div>`
        : `<div class="cob-vazio"><b>${filtros.busca ? 'Nenhum responsável encontrado' : 'Carteira vazia'}</b><div class="muted">${filtros.busca ? 'Tente outro termo.' : 'Importe o arquivo de carteira da escola.'}</div></div>`;
      el.querySelectorAll('[data-resp]').forEach(tr => {
        const abrir = async () => { try { const x = await orgApi(`/responsaveis/${tr.dataset.resp}/caso`); abrirCaso(x.caso_id, null); } catch (e) { B().toast(e.message, true); } };
        tr.onclick = abrir; tr.onkeydown = e => { if (e.key === 'Enter') abrir(); };
      });
      $('#ccAnt') && ($('#ccAnt').onclick = () => { filtros.pagina--; carregar(); });
      $('#ccProx') && ($('#ccProx').onclick = () => { filtros.pagina++; carregar(); });
    } catch (e) { msgErro(el, e); }
  };
  let t; $('#ccBusca').oninput = e => { clearTimeout(t); t = setTimeout(() => { filtros.busca = e.target.value; filtros.pagina = 1; carregar(); }, 300); };
  $('#ccUn') && ($('#ccUn').onchange = e => { filtros.unidade = e.target.value; filtros.pagina = 1; carregar(); });
  carregar();
}

// ---------- Importação ----------
async function paginaImportar(raiz, loteId = null) {
  const podeImp = pode('carteira.importar');
  raiz.innerHTML = cabecalho(podeImp ? 'Importar carteira' : 'Importações', `${cob.ctx.organizacao.nome} · nada muda na carteira até você aplicar a prévia`) +
    (podeImp ? `<div class="card pad"><div class="cob-form-linha">
      <label class="cob-campo">Arquivo da escola (CSV ou XLSX)<input class="input" type="file" id="ciArq" accept=".csv,.xlsx"></label>
      <label class="cob-campo">Data de referência dos saldos<input class="input" type="date" id="ciRef" value="${hojeISO()}" max="${hojeISO()}"></label>
      <label class="cob-campo">O arquivo traz<select class="input" id="ciEsc"><option value="COMPLETA">Toda a carteira em aberto das unidades do arquivo</option><option value="PARCIAL">Só parte dos títulos (não sinaliza ausentes)</option></select></label>
      <button class="btn primary" id="ciPrev">Gerar prévia</button></div>
      <div class="small muted">Colunas: id_titulo, unidade, responsavel_id, responsavel_nome, telefone, contato_autorizado, aluno_matricula, aluno_nome, competencia, vencimento, valor, saldo, situacao. CPF completo não é necessário.</div></div>` : '') +
    '<div id="ciPrevia"></div><div class="card pad"><h3>Lotes</h3><div id="ciLotes" class="muted">Carregando…</div></div>';
  ligarSeletor('cobImportar');
  if ($('#ciPrev')) $('#ciPrev').onclick = async () => {
    const arq = $('#ciArq').files[0];
    if (!arq) return B().toast('Escolha o arquivo', true);
    try {
      const buf = new Uint8Array(await arq.arrayBuffer()); let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const r = await orgApi('/lotes', { method: 'POST', body: { arquivo_nome: arq.name, conteudo_base64: btoa(bin), data_referencia: $('#ciRef').value, escopo: $('#ciEsc').value } });
      paginaImportar(raiz, r.id);
    } catch (e) { msgErro($('#ciPrevia'), e); }
  };
  if (loteId) mostrarLote(loteId, raiz);
  try {
    const lotes = await orgApi('/lotes');
    $('#ciLotes').innerHTML = lotes.length ? `<table class="cob-tabela"><thead><tr><th>Arquivo</th><th>Referência</th><th>Situação</th><th class="num">Novos</th><th class="num">Alterados</th><th class="num">Rejeitados</th><th class="num">Ausentes</th><th>Por</th></tr></thead><tbody>${lotes.map(l => `
      <tr class="cob-clicavel" data-lote="${esc(l.id)}"><td>${esc(l.arquivo_nome)}<div class="small muted">${quando(l.criado_em)}</div></td><td>${dataBR(l.data_referencia)}</td>
      <td>${l.status === 'APLICADO' ? chip('Aplicado', 'ok', '✓') : l.status === 'PREVIA' ? chip('Prévia', 'info', '…') : chip('Descartado', 'neutro', '–')}</td>
      <td class="num">${l.resumo.novos}</td><td class="num">${l.resumo.alterados}</td><td class="num">${l.resumo.rejeitados}</td><td class="num">${l.resumo.ausentes}</td><td>${esc(l.usuario_nome || '')}</td></tr>`).join('')}</tbody></table>` : 'Nenhum lote importado.';
    $('#ciLotes').querySelectorAll('[data-lote]').forEach(tr => tr.onclick = () => paginaImportar(raiz, tr.dataset.lote));
  } catch (e) { msgErro($('#ciLotes'), e); }
}

async function mostrarLote(id, raiz) {
  const el = $('#ciPrevia');
  try {
    const l = await orgApi(`/lotes/${id}`), r = l.resumo;
    const problemas = l.linhas.filter(x => ['REJEITADO', 'REPETIDO'].includes(x.status) || x.motivo);
    el.innerHTML = `<div class="card pad"><div class="section-title"><div><h3>${l.status === 'PREVIA' ? 'Prévia' : l.status === 'APLICADO' ? 'Lote aplicado' : 'Lote descartado'} · ${esc(l.arquivo_nome)}</h3>
      <div class="small muted">Referência ${dataBR(l.data_referencia)} · ${l.escopo === 'COMPLETA' ? 'carteira completa' : 'parcial'} · por ${esc(l.usuario_nome || '')} em ${quando(l.criado_em)}</div></div>
      ${l.status === 'PREVIA' && pode('carteira.importar') ? `<div><button class="btn primary" id="clAplicar">${r.novos + r.alterados ? `Aplicar ${r.novos + r.alterados} mudança(s)` : 'Aplicar (sem mudanças)'}</button> <button class="btn" id="clDescartar">Descartar</button></div>` : ''}</div>
      ${r.arquivo_ja_aplicado_em ? aviso(`Este mesmo arquivo já foi aplicado em ${quando(r.arquivo_ja_aplicado_em)}. Reaplicar não duplica registros.`) : ''}
      <div class="cob-indicadores"><div class="card pad"><span>Válidos</span><b>${r.validos}</b><small>${r.novos} novos · ${r.alterados} alterados · ${r.sem_mudanca} sem mudança</small></div>
      <div class="card pad"><span>Repetidos</span><b>${r.repetidos}</b><small>linhas idênticas ignoradas</small></div>
      <div class="card pad"><span>Rejeitados</span><b>${r.rejeitados}</b><small>motivos abaixo</small></div>
      <div class="card pad"><span>Ausentes</span><b>${r.ausentes}</b><small>em aberto antes, fora do arquivo</small></div></div>
      ${r.ausentes ? aviso(`${r.ausentes} título(s) não vieram neste arquivo. Ausência não comprova pagamento: ficam pausados para conferência com a escola.`, 'atencao') : ''}
      ${problemas.length ? `<table class="cob-tabela"><thead><tr><th>Linha</th><th>Título</th><th>Responsável</th><th>Situação</th><th>Motivo</th></tr></thead><tbody>${problemas.map(x => `<tr><td>${x.linha}</td><td>${esc(x.id_titulo || '—')}</td><td>${esc(x.responsavel || '—')}</td><td>${x.status === 'REJEITADO' ? chip('Rejeitado', 'alerta', '✕') : x.status === 'REPETIDO' ? chip('Repetido', 'neutro', '=') : chip('Com aviso', 'atencao', '!')}</td><td>${esc(x.motivo || '')}</td></tr>`).join('')}</tbody></table>` : aviso('Nenhuma linha rejeitada.', 'ok')}
      <div id="clMsg"></div></div>`;
    const agir = async a => { try { await orgApi(`/lotes/${id}/${a}`, { method: 'POST', body: {} }); await carregarCtx(); paginaImportar(raiz, id); } catch (e) { msgErro($('#clMsg'), e); } };
    $('#clAplicar') && ($('#clAplicar').onclick = () => agir('aplicar'));
    $('#clDescartar') && ($('#clDescartar').onclick = () => agir('descartar'));
  } catch (e) { msgErro(el, e); }
}

// ---------- Caso ----------
export function abrirCaso(casoId, voltarConversa, orgId = null) {
  if (orgId) { cob.org = orgId; gravarOrg(orgId); }
  cob.casoId = casoId; cob.voltarConversa = voltarConversa || null;
  B().nav('cobCaso');
}

async function paginaCaso(raiz) {
  if (!cob.casoId) { raiz.innerHTML = aviso('Escolha um caso na fila ou na carteira.'); return; }
  const titulo = $('#pageTitle'); if (titulo) titulo.textContent = 'Caso de cobrança';
  let c;
  try { c = await orgApi(`/casos/${cob.casoId}`); }
  catch (e) { raiz.innerHTML = cabecalho('Caso de cobrança') + (e.status === 404 ? aviso('Caso não encontrado ou fora das escolas e unidades que você pode acessar.', 'erro') : aviso(e.message, 'erro')); return; }
  const me = B().state.me;
  const minha = c.trava?.usuario_id === me.id;
  const unidades = [...new Set(c.alunos.map(a => a.unidade_nome).filter(Boolean))];
  const conexoes = cob.ctx.conexoes || [];
  raiz.innerHTML = `<div class="section-title cob-cab"><div><h2>${esc(c.responsavel.nome)}</h2><div class="muted small">${esc(c.organizacao.nome)}${unidades.length ? ' · ' + esc(unidades.join(', ')) : ''} · código ${esc(c.responsavel.chave_origem)}</div></div>
    <div class="cob-cab-acoes">${cob.voltarConversa ? '<button class="btn" id="caVoltar">‹ Voltar à conversa</button>' : ''}<button class="btn" id="caFila">Fila de cobrança</button></div></div>
    ${c.trava && !minha ? aviso(`${c.trava.nome || 'Outro atendente'} está trabalhando este caso até ${quando(c.trava.ate)}.`, 'atencao') : minha ? aviso(`Você está com este caso até ${quando(c.trava.ate)}.`) : ''}
    <div class="cob-acoes">${!minha && !c.trava ? '<button class="btn primary" id="caAssumir">Assumir caso</button>' : ''}${c.trava && !minha && pode('fila.distribuir') ? '<button class="btn" id="caForcar">Assumir mesmo assim</button>' : ''}${minha ? '<button class="btn" id="caLiberar">Liberar caso</button>' : ''}</div>
    <div id="caMsg"></div>
    <div class="cob-indicadores">
      <div class="card pad"><span>Saldo negociável</span><b>${reais(c.totais.saldo_negociavel_centavos)}</b><small>${c.totais.titulos_negociaveis} título(s)</small></div>
      <div class="card pad"><span>Títulos pausados</span><b>${c.totais.titulos_pausados}</b><small>contestados, em análise ou ausentes</small></div>
      <div class="card pad"><span>Próxima ação</span><b>${c.proxima_acao.em ? dataBR(c.proxima_acao.em) : 'Hoje'}</b><small>${esc(ACAO[c.proxima_acao.tipo] || 'primeiro contato')}</small></div>
      <div class="card pad"><span>Contato</span><b>${c.responsavel.contato_autorizado ? 'Autorizado' : 'Não autorizado'}</b><small>${esc(telBR(c.responsavel.telefone) || 'sem telefone')}</small></div>
    </div>
    <div class="cob-grade">
      <div>
        <div class="card pad"><h3>Títulos</h3><div class="small muted">Alunos: ${c.alunos.map(a => `${esc(a.nome || 'Aluno')} (mat. ${esc(a.matricula)}${a.unidade_nome ? ' · ' + esc(a.unidade_nome) : ''})`).join(' · ') || '—'}</div>
          ${tabelaTitulos(c.titulos, true)}</div>
        <div class="card pad" id="acordosCaso">Carregando acordos…</div>
        <div class="card pad"><h3>Registrar contato</h3>${formContato(minha)}</div>
      </div>
      <div>
        <div class="card pad"><h3>WhatsApp</h3>
          ${c.conversas.length ? `<div class="small">Conversas do caso:</div>${c.conversas.map(v => `<div><a href="#" data-conv="${esc(v.ultima_conversation_id || '')}">${esc(conexoes.find(x => x.instance_id === v.instance_id)?.nome || v.instance_id)}</a> · ${v.verificada_em ? chip('Identidade confirmada', 'ok', '✓') : chip('Aguardando confirmação', 'atencao', '?')}</div>`).join('')}` : ''}
          ${!pode('conversa.enviar') ? '<div class="muted small">Seu perfil não envia mensagens.</div>'
            : c.bloqueios_contato_ativo.length ? c.bloqueios_contato_ativo.map(b => aviso(b.texto, 'atencao')).join('')
              : `<div class="small muted">O primeiro contato apresenta o atendente, a GO Negocia e a escola, sem valores. A conversa abre na conexão da escola.</div>
                 ${conexoes.length > 1 ? `<select class="input" id="caCx">${conexoes.map(x => `<option value="${esc(x.instance_id)}">${esc(x.nome)} · ${x.modo_envio === 'TESTE' ? 'teste' : 'real'}</option>`).join('')}</select>` : ''}
                 <button class="btn primary" id="caAtivo" ${minha ? '' : 'disabled'}>Iniciar contato pelo WhatsApp</button>${minha ? '' : '<div class="small muted">Assuma o caso antes.</div>'}`}
          <div id="caAtivoMsg"></div></div>
        <div class="card pad"><h3>Pendências</h3>
          ${c.pendencias.length ? c.pendencias.map(p => `<div class="cob-pend"><div><b>${esc(p.protocolo)}</b> · ${esc(MOTIVO[p.motivo])}<div class="small muted">Pendência: ${esc(PEND[p.status_pendencia] || p.status_pendencia)}${p.prazo ? ' · prazo ' + dataBR(p.prazo) : ''} · Cobrança: ${p.status_cobranca === 'TITULOS_PAUSADOS' ? 'títulos pausados' : p.status_cobranca === 'TITULOS_LIBERADOS' ? 'títulos liberados' : 'sem pausa'}</div></div>
            ${p.status_cobranca === 'TITULOS_PAUSADOS' && pode('fila.distribuir') ? `<button class="btn small" data-liberar="${esc(p.pendencia_id)}">Liberar títulos</button>` : ''}</div>`).join('') : '<div class="muted small">Nenhuma pendência de cobrança.</div>'}
          <details ${c.pendencias.length ? '' : 'open'}><summary class="small">Abrir pendência</summary>
            <label class="cob-campo">Motivo<select class="input" id="cpMotivo">${Object.entries(MOTIVO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <div class="small">Títulos afetados:</div>${c.titulos.filter(t => t.situacao === 'ABERTO').map(t => `<label class="small cob-check"><input type="checkbox" value="${esc(t.id)}" class="cpTit"> ${esc(t.id_origem)} · ${esc(t.aluno_nome || '')} · venc. ${dataBR(t.vencimento)}</label>`).join('')}
            <label class="cob-campo">Descrição<textarea class="input" id="cpDesc" rows="2" placeholder="O que a família informou (evite valores)"></textarea></label>
            <button class="btn" id="cpCriar">Criar pendência</button><div class="small muted">Contestação e comprovante pausam os títulos. Concluir a pendência não quita nem libera: liberar é decisão do supervisor.</div><div id="cpMsg"></div></details></div>
        <div class="card pad"><h3>Histórico</h3>${c.contatos.length ? c.contatos.map(ct => `<div class="cob-hist"><b>${esc(RESULTADO[ct.resultado] || ct.resultado)}</b> · ${esc(ct.canal.toLowerCase())} · ${ct.direcao === 'ATIVO' ? 'ativo' : 'receptivo'}<div class="small muted">${quando(ct.em)} · ${esc(ct.usuario_nome || '')}</div>${ct.promessa_data ? `<div class="small">Promessa para ${dataBR(ct.promessa_data)}${ct.promessa_centavos ? ' · ' + reais(ct.promessa_centavos) : ''}</div>` : ''}${ct.nota ? `<div class="small">${esc(ct.nota)}</div>` : ''}</div>`).join('') : '<div class="muted small">Nenhum contato registrado.</div>'}</div>
      </div>
    </div>`;
  const recarregar = () => paginaCaso(raiz);
  const acao = async (fn, ok) => { try { await fn(); if (ok) B().toast(ok); recarregar(); } catch (e) { msgErro($('#caMsg'), e); window.scrollTo(0, 0); } };
  $('#caVoltar') && ($('#caVoltar').onclick = () => B().abrirConversa(cob.voltarConversa));
  $('#caFila').onclick = () => B().nav('cobFila');
  $('#caAssumir') && ($('#caAssumir').onclick = () => acao(() => orgApi(`/casos/${c.id}/assumir`, { method: 'POST', body: {} })));
  $('#caForcar') && ($('#caForcar').onclick = () => acao(() => orgApi(`/casos/${c.id}/assumir`, { method: 'POST', body: { forcar: true } })));
  $('#caLiberar') && ($('#caLiberar').onclick = () => acao(() => orgApi(`/casos/${c.id}/liberar`, { method: 'POST', body: {} })));
  raiz.querySelectorAll('[data-conv]').forEach(a => a.onclick = e => { e.preventDefault(); if (a.dataset.conv) B().abrirConversa(a.dataset.conv); });
  $('#caAtivo') && ($('#caAtivo').onclick = async () => {
    try { const r = await orgApi(`/casos/${c.id}/contato-ativo`, { method: 'POST', body: { instance_id: $('#caCx')?.value || undefined } }); B().toast(r.status === 'SIMULATED' ? 'Primeiro contato registrado (simulado)' : 'Primeiro contato enviado'); await B().abrirConversa(r.conversation_id); }
    catch (e) { msgErro($('#caAtivoMsg'), e); }
  });
  raiz.querySelectorAll('[data-liberar]').forEach(b => b.onclick = () => acao(() => orgApi(`/pendencias/${b.dataset.liberar}/liberar`, { method: 'POST', body: {} }), 'Títulos liberados'));
  $('#cpCriar').onclick = async () => {
    try {
      const r = await orgApi(`/casos/${c.id}/pendencias`, { method: 'POST', body: { motivo: $('#cpMotivo').value, titulo_ids: [...raiz.querySelectorAll('.cpTit:checked')].map(x => x.value), descricao: $('#cpDesc').value, conversation_id: cob.voltarConversa || null } });
      B().toast(`Pendência ${r.protocolo} criada`); recarregar();
    } catch (e) { msgErro($('#cpMsg'), e); }
  };
  ligarFormContato(raiz, c.id, recarregar);
  const host = raiz.querySelector('#acordosCaso');
  acordosDoCaso(host, c, minha, recarregar).catch(e => msgErro(host, e));
}

function tabelaTitulos(titulos, completa) {
  if (!titulos.length) return '<div class="muted small">Sem títulos visíveis.</div>';
  return `<table class="cob-tabela"><thead><tr><th>Título</th><th>Aluno</th>${completa ? '<th>Competência</th>' : ''}<th>Vencimento</th><th class="num">Saldo</th><th>Situação</th></tr></thead><tbody>${titulos.map(t => `<tr>
    <td>${esc(t.id_origem)}<div class="small muted">${esc(t.unidade_nome || 'Sem unidade')}</div></td><td>${esc(t.aluno_nome || '—')}<div class="small muted">Mat. ${esc(t.aluno_matricula)}</div></td>
    ${completa ? `<td>${t.competencia ? esc(t.competencia.split('-').reverse().join('/')) : '—'}</td>` : ''}
    <td>${dataBR(t.vencimento)}${t.dias_atraso ? `<div class="small muted">${t.dias_atraso} dias de atraso</div>` : ''}</td>
    <td class="num">${reais(t.saldo_centavos)}<div class="small muted">ref. ${dataBR(t.saldo_referencia)}</div></td>
    <td>${chipTitulo(t)}${t.alertas.some(a => a.codigo === 'DESATUALIZADO') ? ' ' + chip('Saldo desatualizado', 'atencao', '⏱') : ''}</td></tr>`).join('')}</tbody></table>`;
}

function formContato(minha) {
  return `<div class="cob-form-linha">
    <label class="cob-campo">Canal<select class="input" id="fcCanal"><option value="WHATSAPP">WhatsApp</option><option value="TELEFONE">Telefone</option><option value="EMAIL">E-mail</option><option value="PRESENCIAL">Presencial</option></select></label>
    <label class="cob-campo">Tipo<select class="input" id="fcDir"><option value="ATIVO">Ativo</option><option value="RECEPTIVO">Receptivo</option></select></label>
    <label class="cob-campo">Resultado<select class="input" id="fcRes">${Object.entries(RESULTADO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
    <div class="cob-form-linha oculto-cob" id="fcRet"><label class="cob-campo">Retorno combinado para<input class="input" type="datetime-local" id="fcRetEm"></label></div>
    <div class="cob-form-linha oculto-cob" id="fcProm"><label class="cob-campo">Data prometida<input class="input" type="date" id="fcPromData" min="${hojeISO()}"></label><label class="cob-campo">Valor prometido (R$)<input class="input" id="fcPromValor" inputmode="decimal" placeholder="0,00"></label><div class="small muted">Promessa não é acordo nem pagamento.</div></div>
    <label class="cob-campo">Anotação<textarea class="input" id="fcNota" rows="2"></textarea></label>
    <div class="cob-form-linha"><label class="cob-campo">Próxima ação em<input class="input" type="date" id="fcProx" min="${hojeISO()}"></label><button class="btn primary" id="fcSalvar" ${minha ? '' : 'disabled'}>Registrar contato</button></div>
    ${minha ? '' : '<div class="small muted">Assuma o caso para registrar.</div>'}<div id="fcMsg"></div>`;
}
function ligarFormContato(raiz, casoId, recarregar) {
  const res = $('#fcRes');
  res.onchange = () => { $('#fcRet').classList.toggle('oculto-cob', res.value !== 'RETORNO_COMBINADO'); $('#fcProm').classList.toggle('oculto-cob', res.value !== 'PROMESSA'); };
  $('#fcSalvar').onclick = async () => {
    const b = { canal: $('#fcCanal').value, direcao: $('#fcDir').value, resultado: res.value, nota: $('#fcNota').value, proxima_acao_em: $('#fcProx').value || null };
    if (b.resultado === 'RETORNO_COMBINADO') b.retorno_em = $('#fcRetEm').value;
    if (b.resultado === 'PROMESSA') { b.promessa_data = $('#fcPromData').value; const v = Math.round(Number(String($('#fcPromValor').value).replace(/\./g, '').replace(',', '.')) * 100); if (v > 0) b.promessa_centavos = v; }
    try { await orgApi(`/casos/${casoId}/contatos`, { method: 'POST', body: b }); B().toast('Contato registrado'); recarregar(); } catch (e) { msgErro($('#fcMsg'), e); }
  };
}

// ---------- Painel "Cobrança" na ficha da conversa ----------
export async function painelConversa(box, c) {
  if (!box || !c || c.isGroup || c.isChannel) return;
  const eu = await carregarEu().catch(() => null);
  if (!box.isConnected || B().state.current?.id !== c.id) return;
  if (!eu || eu.modulos?.cobranca === false || (!eu.admin && !eu.instituicoes.length)) return;
  box.querySelector('#cobPainel')?.remove();
  const el = document.createElement('div');
  el.id = 'cobPainel'; el.className = 'cob-painel';
  el.innerHTML = '<div class="ficha-titulo"><b>Cobrança</b></div><div class="small muted">Carregando…</div>';
  box.prepend(el);
  let d;
  try { d = await apiCob(`/api/cobranca/conversas/${encodeURIComponent(c.id)}`); }
  catch (e) { el.innerHTML = '<div class="ficha-titulo"><b>Cobrança</b></div>' + aviso(e.message, 'erro'); return; }
  if (!el.isConnected || B().state.current?.id !== c.id) return;
  const recarregar = () => painelConversa(box, c);
  let html = '<div class="ficha-titulo"><b>Cobrança</b></div>';
  if (!d.aplicavel) html += `<div class="small muted">${esc(d.motivo)}</div>`;
  else if (d.sem_acesso) html += '<div class="small muted">Esta conversa pertence a uma escola que você não acessa.</div>';
  else if (!d.instituicoes.length) {
    html += `<div class="small muted">A conexão desta conversa não está ligada a uma escola. Associe explicitamente para consultar a cobrança.</div>`;
    html += d.associaveis.length ? `<div class="cob-form-linha"><select class="input" id="cobAssocOrg">${d.associaveis.map(o => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join('')}</select><button class="btn small" id="cobAssociar">Associar</button></div>` : '<div class="small muted">Você não tem escola para associar.</div>';
  }
  for (const [i, inst] of d.instituicoes.entries()) {
    html += `<div class="cob-inst"><div class="small"><b>${esc(inst.organizacao.nome)}</b> · ${inst.origem === 'CONEXAO' ? 'pela conexão' : 'associação manual'}${inst.modo_envio === 'TESTE' ? ' · ' + chip('conexão de teste', 'neutro') : ''}</div>`;
    if (!inst.verificada) {
      html += aviso('Confirme a identidade antes de falar de valores. Os títulos aparecem depois da confirmação.', 'atencao');
      if (inst.pode_trabalhar) html += `<div class="cob-verif" data-i="${i}">
        <label class="cob-campo">Responsável<select class="input cobVResp"><option value="">${inst.sugeridos.length ? 'Escolha o responsável' : 'Busque pelo nome ou código'}</option>${inst.sugeridos.map(r => `<option value="${esc(r.id)}" ${inst.sugeridos.length === 1 ? 'selected' : ''}>${esc(r.nome)} (sugerido)</option>`).join('')}</select></label>
        <input class="input cobVBusca" type="search" placeholder="Buscar responsável nesta escola">
        <label class="cob-campo">Matrícula de um aluno informada pela família<input class="input cobVMat"></label>
        <button class="btn primary small cobVOk">Confirmar identidade</button><div class="cobVMsg"></div></div>`;
    } else if (inst.caso) {
      const k = inst.caso;
      html += `<div class="cob-resumo"><div><span class="small muted">Responsável financeiro</span><b>${esc(k.responsavel.nome)}</b> ${chip('Identidade confirmada', 'ok', '✓')}</div>
        <div class="small">Alunos: ${k.alunos.map(a => `${esc(a.nome || 'Aluno')} (${esc(a.unidade_nome || 'sem unidade')})`).join(' · ') || '—'}</div>
        <div class="cob-mini"><div><span>Saldo negociável</span><b>${reais(k.totais.saldo_negociavel_centavos)}</b></div><div><span>Pausados</span><b>${k.totais.titulos_pausados}</b></div><div><span>Próxima ação</span><b>${k.proxima_acao.em ? dataBR(k.proxima_acao.em) : 'Hoje'}</b><small>${esc(ACAO[k.proxima_acao.tipo] || '')}</small></div></div>
        <div class="cob-lista-tit">${k.titulos.map(t => `<div><span><b>${esc(t.aluno_nome || 'Aluno')}</b> · ${esc(t.id_origem)}</span><span class="v">${reais(t.saldo_centavos)}</span><span class="small muted">venc. ${dataBR(t.vencimento)}${t.dias_atraso ? ` · ${t.dias_atraso} dias` : ''}${t.unidade_nome ? ' · ' + esc(t.unidade_nome) : ''}</span><span>${chipTitulo(t)}</span></div>`).join('') || '<div class="small muted">Sem títulos visíveis.</div>'}</div>
        <div class="small muted">Saldos de ${dataBR(k.titulos[0]?.saldo_referencia)}.</div>
        <button class="btn primary small" data-abrir-caso="${esc(k.id)}" data-org="${esc(inst.organizacao.id)}">Abrir caso de cobrança</button></div>`;
    }
    html += '</div>';
  }
  el.innerHTML = html;
  const associar = el.querySelector('#cobAssociar');
  if (associar) associar.onclick = async () => { try { await apiCob(`/api/cobranca/conversas/${c.id}/associar`, { method: 'POST', body: { organizacao_id: el.querySelector('#cobAssocOrg').value } }); recarregar(); } catch (e) { B().toast(e.message, true); } };
  el.querySelectorAll('[data-abrir-caso]').forEach(b => b.onclick = () => abrirCaso(b.dataset.abrirCaso, c.id, b.dataset.org));
  el.querySelectorAll('.cob-verif').forEach(v => {
    const inst = d.instituicoes[Number(v.dataset.i)];
    const sel = v.querySelector('.cobVResp');
    let t; v.querySelector('.cobVBusca').oninput = e => {
      clearTimeout(t); const q = e.target.value.trim(); if (q.length < 3) return;
      t = setTimeout(async () => { try { const r = await apiCob(`/api/cobranca/o/${inst.organizacao.id}/carteira?busca=${encodeURIComponent(q)}`); sel.innerHTML = '<option value="">Escolha o responsável</option>' + inst.sugeridos.map(x => `<option value="${esc(x.id)}">${esc(x.nome)} (sugerido)</option>`).join('') + r.itens.map(x => `<option value="${esc(x.id)}">${esc(x.nome)} · ${esc(x.chave_origem)}</option>`).join(''); } catch { /* ignora */ } }, 300);
    };
    v.querySelector('.cobVOk').onclick = async () => {
      try {
        const r = await apiCob(`/api/cobranca/conversas/${c.id}/verificar`, { method: 'POST', body: { organizacao_id: inst.organizacao.id, responsavel_id: sel.value, matricula: v.querySelector('.cobVMat').value } });
        B().toast(r.telefone_confere ? 'Identidade confirmada' : 'Identidade confirmada — telefone diferente do cadastro da escola');
        recarregar();
      } catch (e) { msgErro(v.querySelector('.cobVMsg'), e); }
    };
  });
}

// ---------- Escolas e acessos (administração) ----------
async function paginaEscolas(raiz) {
  if (!cob.eu?.admin) { raiz.innerHTML = aviso('Apenas o administrador.', 'erro'); return; }
  const [orgs, bal] = await Promise.all([apiCob('/api/cobranca/admin/organizacoes'), apiCob('/api/cobranca/admin/balbino')]);
  const blocos = await Promise.all(orgs.map(async o => {
    const [uns, cxs, acs] = await Promise.all([apiCob(`/api/cobranca/admin/organizacoes/${o.id}/unidades`), apiCob(`/api/cobranca/admin/organizacoes/${o.id}/conexoes`), apiCob(`/api/cobranca/admin/organizacoes/${o.id}/acessos`)]);
    return { o, uns, cxs, acs };
  }));
  const nomeU = id => bal.usuarios.find(u => u.id === id)?.name || id;
  const nomeCx = id => bal.conexoes.find(c => c.id === id)?.name || id;
  const mods = await apiCob('/api/cobranca/admin/modulos');
  const cartaoModulos = `<div class="card pad"><h3>Módulos por usuário</h3><div class="small muted">Libere só Mensagens, só Cobrança ou os dois. Sem Mensagens, o usuário não vê conversas nem faz contato ativo. Sem Cobrança, não vê carteira nem o painel Cobrança. O acesso a cada escola continua definido abaixo.</div>
    <table class="cob-tabela"><thead><tr><th>Usuário</th><th>Perfil</th><th>Mensagens</th><th>Cobrança</th></tr></thead><tbody>${mods.map(x => `<tr data-mod="${esc(x.id)}"><td>${esc(x.name)}<div class="small muted">${esc(x.username)}</div></td><td>${esc({ SUPER_ADMIN: 'Administrador geral', SUPERVISOR: 'Supervisor', AGENT: 'Atendente' }[x.role] || x.role)}</td>
    <td><label class="cob-check"><input type="checkbox" class="mAt" ${x.modulos.atendimento ? 'checked' : ''} ${x.role === 'SUPER_ADMIN' ? 'disabled' : ''}> liberado</label></td>
    <td><label class="cob-check"><input type="checkbox" class="mCo" ${x.modulos.cobranca ? 'checked' : ''} ${x.role === 'SUPER_ADMIN' ? 'disabled' : ''}> liberado</label></td></tr>`).join('')}</tbody></table><div id="ceModMsg"></div></div>`;
  raiz.innerHTML = cabecalho('Escolas e acessos', 'Cada escola tem unidades, conexões de WhatsApp e equipe autorizada próprias.') + cartaoModulos +
    `<div class="card pad"><div class="cob-form-linha"><input class="input" id="ceNome" placeholder="Nome da escola"><button class="btn primary" id="ceCriar">Cadastrar escola</button></div><div id="ceMsg"></div></div>` +
    blocos.map(({ o, uns, cxs, acs }) => `<div class="card pad cob-escola" data-org="${esc(o.id)}"><h3>${esc(o.nome)}</h3>
      <div class="small muted">Saldo válido por ${o.dias_saldo_valido} dias · verificação: matrícula do aluno</div>
      <h4>Unidades</h4><div>${uns.map(u => chip(`${u.nome} · ${u.codigo}`, 'info')).join(' ') || '<span class="small muted">Sem unidades (opcional)</span>'}</div>
      <div class="cob-form-linha"><input class="input ceUnNome" placeholder="Nome da unidade"><input class="input ceUnCod" placeholder="Código no arquivo (ex.: CEN)"><button class="btn small ceUnAdd">Adicionar unidade</button></div>
      <h4>Conexões de WhatsApp</h4><div class="small muted">A conexão define a escola das conversas. Uma conexão atende uma escola.</div>
      ${cxs.map(c => `<div class="cob-linha">${esc(nomeCx(c.instance_id))} · ${c.modo_envio === 'TESTE' ? chip('teste: nada é enviado', 'neutro') : chip('envio real', 'alerta')} <button class="btn small" data-desv="${esc(c.instance_id)}">Desvincular</button></div>`).join('') || '<div class="small muted">Nenhuma conexão vinculada.</div>'}
      <div class="cob-form-linha"><select class="input ceCx">${bal.conexoes.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><select class="input ceModo"><option value="TESTE">Teste (não envia)</option><option value="REAL">Real</option></select><button class="btn small ceCxAdd">Vincular conexão</button></div>
      <h4>Equipe</h4>${acs.map(a => `<div class="cob-linha">${esc(nomeU(a.usuario_id))} · ${esc(PAPEL[a.papel])} · ${a.todas_unidades ? 'todas as unidades' : esc(uns.filter(u => a.unidades.includes(u.id)).map(u => u.nome).join(', '))}</div>`).join('') || '<div class="small muted">Ninguém autorizado ainda.</div>'}
      <div class="cob-form-linha"><select class="input ceUs">${bal.usuarios.filter(u => u.role !== 'SUPER_ADMIN').map(u => `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.username)})</option>`).join('')}</select>
        <select class="input cePapel"><option value="ATENDENTE">Atendente</option><option value="SUPERVISOR">Supervisor</option><option value="REPRESENTANTE">Representante da escola</option><option value="">Remover acesso</option></select>
        ${uns.length ? `<span class="small">Unidades (vazio = todas): ${uns.map(u => `<label class="cob-check"><input type="checkbox" class="ceUn" value="${esc(u.id)}"> ${esc(u.nome)}</label>`).join('')}</span>` : ''}
        <button class="btn small ceAcAdd">Salvar acesso</button></div><div class="ceErr"></div></div>`).join('');
  ligarSeletor('cobEscolas');
  const recarregar = () => paginaEscolas(raiz);
  raiz.querySelectorAll('[data-mod]').forEach(tr => tr.querySelectorAll('input').forEach(i => i.onchange = async () => {
    try { await apiCob(`/api/cobranca/admin/modulos/${encodeURIComponent(tr.dataset.mod)}`, { method: 'PUT', body: { atendimento: tr.querySelector('.mAt').checked, cobranca: tr.querySelector('.mCo').checked } }); B().toast('Módulos atualizados'); }
    catch (e) { msgErro($('#ceModMsg'), e); recarregar(); }
  }));
  $('#ceCriar').onclick = async () => { try { await apiCob('/api/cobranca/admin/organizacoes', { method: 'POST', body: { nome: $('#ceNome').value } }); await carregarEu(true); recarregar(); } catch (e) { msgErro($('#ceMsg'), e); } };
  raiz.querySelectorAll('.cob-escola').forEach(box => {
    const id = box.dataset.org, err = box.querySelector('.ceErr');
    const faz = async (fn) => { try { await fn(); recarregar(); } catch (e) { msgErro(err, e); } };
    box.querySelector('.ceUnAdd').onclick = () => faz(() => apiCob(`/api/cobranca/admin/organizacoes/${id}/unidades`, { method: 'POST', body: { nome: box.querySelector('.ceUnNome').value, codigo: box.querySelector('.ceUnCod').value } }));
    box.querySelector('.ceCxAdd').onclick = () => faz(() => apiCob(`/api/cobranca/admin/organizacoes/${id}/conexoes/${encodeURIComponent(box.querySelector('.ceCx').value)}`, { method: 'PUT', body: { modo_envio: box.querySelector('.ceModo').value } }));
    box.querySelectorAll('[data-desv]').forEach(b => b.onclick = () => faz(() => apiCob(`/api/cobranca/admin/organizacoes/${id}/conexoes/${encodeURIComponent(b.dataset.desv)}`, { method: 'DELETE' })));
    box.querySelector('.ceAcAdd').onclick = () => faz(() => apiCob(`/api/cobranca/admin/organizacoes/${id}/acessos/${encodeURIComponent(box.querySelector('.ceUs').value)}`, { method: 'PUT', body: { papel: box.querySelector('.cePapel').value || null, unidades: [...box.querySelectorAll('.ceUn:checked')].map(x => x.value) } }));
  });
}

const STATUS_ACORDO = { REVISAO:'Em aprovação', PROPOSTA:'Proposta', ACEITO:'Aceito', QUITADO:'Quitado', CANCELADO:'Cancelado' };
const unidadeTexto = u => esc(u || 'Sem unidade');
const dadosForm = f => Object.fromEntries(new FormData(f));
const percent = n => Math.round(Number(n)*100);
function tabelaFinanceira(colunas, linhas) {
  if (!linhas.length) return '<p class="small muted">Nenhum registro.</p>';
  return `<div style="overflow:auto"><table class="cob-tabela"><thead><tr>${colunas.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function downloadCsv(nome, linhas) {
  const cell = v => {
    const s = String(v ?? '');
    const safe = typeof v === 'string' && /^[\s\uFEFF]*[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return '"' + safe.replace(/"/g,'""') + '"';
  };
  const url = URL.createObjectURL(new Blob(['\uFEFF',linhas.map(l=>l.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a'); a.href=url; a.download=nome; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function fichaAcordo(a, { minha = false, supervisor = false, abrir = false } = {}) {
  return `<details class="card pad">
    <summary><b>${esc(a.id_origem)}</b> · ${esc(a.responsavel)} · ${esc(STATUS_ACORDO[a.status])} · ${reais(a.total_centavos)}</summary>
    <p class="small muted">${unidadeTexto(a.unidade)} · Recebido ${reais(a.recebido_centavos)}${a.aceito_em ? ' · Aceite ' + quando(a.aceito_em) : ''}</p>
    ${tabelaFinanceira(['Parcela','Vencimento','Valor','Recebido'],a.parcelas.map(p=>[p.numero || 'Entrada',
      dataBR(p.vencimento) + (a.status==='ACEITO' && p.pago_centavos<p.valor_centavos && p.vencimento<hojeISO() ? ' · Em atraso' : ''),
      reais(p.valor_centavos),reais(p.pago_centavos)]))}
    <div class="cob-form-linha">
      ${abrir ? `<button class="btn small" data-ver-caso="${esc(a.caso_id)}">Abrir caso</button>` : ''}
      ${supervisor && a.status==='REVISAO' ? `<button class="btn small" data-acordo="${a.id}" data-acao="aprovar">Aprovar exceção</button>` : ''}
      ${minha && a.status==='PROPOSTA' ? `<label class="cob-campo">Referência do aceite<input class="input" data-prova="${a.id}" maxlength="500" placeholder="Protocolo ou referência da mensagem"></label><button class="btn primary small" data-acordo="${a.id}" data-acao="aceitar">Registrar aceite</button>` : ''}
      ${((minha || supervisor) && ['REVISAO','PROPOSTA'].includes(a.status) || supervisor && a.status==='ACEITO' && !a.recebido_centavos) ? `<button class="btn small" data-acordo="${a.id}" data-acao="cancelar">Cancelar acordo</button>` : ''}
    </div><div data-erro-acordo></div>
  </details>`;
}

function ligarAcoesAcordo(raiz,recarregar) {
  const org = cob.org;
  raiz.querySelectorAll('[data-ver-caso]').forEach(b=>b.onclick=()=>abrirCaso(b.dataset.verCaso));
  raiz.querySelectorAll('[data-acordo]').forEach(b=>b.onclick=async()=>{
    const card=b.closest('details'), {acordo,acao}=b.dataset;
    if (acao==='cancelar' && !confirm('Cancelar este acordo?')) return;
    const prova=card.querySelector('[data-prova]')?.value;
    b.disabled=true;
    try {
      await apiCob(`/api/cobranca/o/${org}/acordos/${acordo}`,{method:'POST',body:{acao,prova}});
      if (org===cob.org) await recarregar();
    } catch(e) { msgErro(card.querySelector('[data-erro-acordo]'),e); b.disabled=false; }
  });
}

async function paginaAcordos(raiz,pagina=1) {
  const org=cob.org, supervisor=pode('fila.distribuir'), editar=supervisor&&cob.ctx.todas_unidades;
  const [regras,acordos]=await Promise.all([orgApi('/regras-negociacao'),orgApi(`/acordos?pagina=${pagina}`)]);
  if (org!==cob.org) return;
  raiz.innerHTML=cabecalho('Acordos e parcelamentos','Crie propostas a partir de um título no caso de cobrança. Use esta tela para acompanhar parcelas e aprovar exceções.')+
    `<div class="card pad"><h3>Regras da escola</h3><p class="small">Desconto até ${regras.desconto_max_bp/100}% · até ${regras.parcelas_max} parcela(s), contando a entrada · entrada mínima de ${regras.entrada_min_bp/100}%.</p>
    ${editar ? `<form class="cob-form-linha" id="regraForm"><label class="cob-campo">Desconto máximo (%)<input required class="input" type="number" name="desconto" min="0" max="99.99" step="0.01" value="${regras.desconto_max_bp/100}"></label>
    <label class="cob-campo">Máximo de parcelas<input required class="input" type="number" name="parcelas" min="1" max="60" value="${regras.parcelas_max}"></label>
    <label class="cob-campo">Entrada mínima (%)<input required class="input" type="number" name="entrada" min="0" max="100" step="0.01" value="${regras.entrada_min_bp/100}"></label>
    <button class="btn primary">Salvar regras</button></form>` : ''}<div id="regraErro"></div></div>
    <div>${acordos.map(a=>fichaAcordo(a,{supervisor,abrir:true})).join('')||'<p class="small muted">Nenhum acordo registrado.</p>'}</div>
    <div class="cob-acoes">${pagina>1?'<button class="btn" id="acoAnterior">Anterior</button>':''}${acordos.length===50?'<button class="btn" id="acoProxima">Próxima</button>':''}</div>`;
  ligarSeletor('cobAcordos');
  ligarAcoesAcordo(raiz,()=>paginaAcordos(raiz,pagina));
  const form=raiz.querySelector('#regraForm');
  if(form) form.onsubmit=async e=>{
    e.preventDefault();
    const v=dadosForm(form);
    try { await apiCob(`/api/cobranca/o/${org}/regras-negociacao`,{method:'PUT',body:{desconto_max_bp:percent(v.desconto),parcelas_max:Number(v.parcelas),entrada_min_bp:percent(v.entrada)}}); if(org===cob.org) await paginaAcordos(raiz,pagina); }
    catch(ex) { msgErro(raiz.querySelector('#regraErro'),ex); }
  };
  const paginar=n=>paginaAcordos(raiz,n).catch(e=>B().toast(e.message,true));
  if(raiz.querySelector('#acoAnterior')) raiz.querySelector('#acoAnterior').onclick=()=>paginar(pagina-1);
  if(raiz.querySelector('#acoProxima')) raiz.querySelector('#acoProxima').onclick=()=>paginar(pagina+1);
}

async function acordosDoCaso(host,c,minha,recarregar) {
  const org=cob.org;
  const acordos=await orgApi(`/acordos?caso=${encodeURIComponent(c.id)}`);
  if(!host.isConnected || org!==cob.org) return;
  const titulos=c.titulos.filter(t=>t.negociavel && t.saldo_centavos>0 && !t.alertas.some(a=>a.codigo==='DESATUALIZADO'));
  host.innerHTML=`<h3>Acordos e parcelas</h3>${acordos.map(a=>fichaAcordo(a,{minha,supervisor:pode('fila.distribuir')})).join('') || '<p class="small muted">Nenhum acordo neste caso.</p>'}
    ${minha&&titulos.length ? `<details><summary>Nova proposta por título</summary><form id="novoAcordo">
      <label class="cob-campo">Título<select name="titulo_id" class="input">${titulos.map(t=>`<option value="${esc(t.id)}">${esc(t.id_origem)} · ${reais(t.saldo_centavos)}</option>`).join('')}</select></label>
      <div class="cob-form-linha"><label class="cob-campo">Valor total (R$)<input class="input" required type="number" name="total" min="0.01" step="0.01"></label>
      <label class="cob-campo">Entrada (R$)<input class="input" required type="number" name="entrada" min="0" step="0.01" value="0"></label>
      <label class="cob-campo">Parcelas após entrada<input class="input" required type="number" name="parcelas" min="1" max="60" value="1"></label>
      <label class="cob-campo">Primeiro vencimento ou entrada<input class="input" required type="date" name="primeiro_vencimento" min="${hojeISO()}"></label></div>
      <button class="btn primary">Registrar proposta</button></form></details>` : '<p class="small muted">Para criar proposta, assuma o caso e confira se há título com saldo atualizado.</p>'}
    <div id="novoAcordoErro"></div>`;
  ligarAcoesAcordo(host,recarregar);
  const form=host.querySelector('#novoAcordo');
  if(form) form.onsubmit=async e=>{
    e.preventDefault();
    const v=dadosForm(form), botao=form.querySelector('button');
    botao.disabled=true;
    try {
      const r=await apiCob(`/api/cobranca/o/${org}/casos/${c.id}/acordos`,{method:'POST',body:{titulo_id:v.titulo_id,total_centavos:percent(v.total),entrada_centavos:percent(v.entrada),parcelas:Number(v.parcelas),primeiro_vencimento:v.primeiro_vencimento}});
      B().toast(r.status==='REVISAO'?'Proposta encaminhada para aprovação':'Proposta registrada');
      if(host.isConnected && org===cob.org) await recarregar();
    } catch(ex) { msgErro(host.querySelector('#novoAcordoErro'),ex); botao.disabled=false; }
  };
}

function paginaRetorno(raiz) {
  const org=cob.org;
  raiz.innerHTML=cabecalho('Retorno de pagamentos','Confira os pagamentos e estornos informados pela escola antes de baixar valores.')+
    (!pode('carteira.importar')||!cob.ctx.todas_unidades ? aviso('O retorno exige permissão de importação e acesso a todas as unidades.') :
    `<div class="card pad"><p>Use um CSV ou XLSX com as colunas id_titulo, referencia, tipo, data, valor e estorna. Informe uma referência única por movimento.</p>
      <p class="small muted">Use PAGAMENTO para valor confirmado ou ESTORNO para reverter parte ou todo um pagamento. No estorno, preencha a referência original na coluna estorna. As baixas ocorrem apenas após aplicar a prévia.</p>
      <div class="cob-form-linha"><button class="btn" id="retModelo">Baixar modelo CSV</button><input class="input" type="file" id="retArquivo" aria-label="Arquivo de retorno" accept=".csv,.xlsx"><button class="btn primary" id="retPrevia">Gerar prévia</button></div>
      <div id="retResultado"></div></div>`);
  ligarSeletor('cobRetorno');
  const btn=raiz.querySelector('#retPrevia');
  if(!btn) return;
  raiz.querySelector('#retModelo').onclick=()=>downloadCsv('modelo-retorno.csv',[['id_titulo','referencia','tipo','data','valor','estorna']]);
  const arquivo=raiz.querySelector('#retArquivo'), saida=raiz.querySelector('#retResultado');
  const post=body=>apiCob(`/api/cobranca/o/${org}/retorno`,{method:'POST',body});
  arquivo.onchange=()=>{saida.innerHTML='';};
  btn.onclick=async()=>{
    const file=arquivo.files[0];
    if(!file||file.size>2*1024*1024) return msgErro(saida,new Error('Selecione um arquivo de até 2 MB.'));
    btn.disabled=arquivo.disabled=true;
    saida.innerHTML=aviso('Analisando…');
    try {
      const base64=await new Promise((resolve,reject)=>{
        const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=reject; reader.readAsDataURL(file);
      });
      const body={arquivo_nome:file.name,conteudo_base64:base64};
      const r=await post(body);
      saida.innerHTML=aviso(`${r.validos} válidos · ${r.rejeitados} rejeitados · ${r.linhas.length-r.validos-r.rejeitados} repetidos`)+
        tabelaFinanceira(['Linha','Título','Referência','Resultado','Saldo anterior','Novo saldo'],r.linhas.map(l=>[l.linha,esc(l.id_titulo),esc(l.referencia),esc(l.motivo||{VALIDO:'Válido',REPETIDO:'Já registrado'}[l.status]),reais(l.antes),reais(l.depois)]))+
        (!r.rejeitados && r.validos ? '<button class="btn primary" id="retAplicar">Aplicar movimentos confirmados</button><div id="retErro"></div>' : '');
      const aplicar=saida.querySelector('#retAplicar');
      if(aplicar) aplicar.onclick=async()=>{
        if(org!==cob.org || arquivo.files[0]!==file || !confirm(`Aplicar ${r.validos} movimentos confirmados na escola selecionada?`)) return;
        aplicar.disabled=true;
        try { const fim=await post({...body,token:r.token}); saida.innerHTML=aviso(`${fim.validos} movimentos registrados.`); }
        catch(e) { msgErro(saida.querySelector('#retErro'),e); aplicar.disabled=false; }
      };
    } catch(e) { msgErro(saida,e); }
    finally { btn.disabled=arquivo.disabled=false; }
  };
}

async function paginaRelatorio(raiz) {
  const org=cob.org, hoje=hojeISO();
  raiz.innerHTML=cabecalho('Relatório para a escola','Carteira atual e recuperação confirmada no período. Filtre por unidade ou exporte a conciliação por título.')+
    `<form class="cob-form-linha" id="relForm"><label class="cob-campo">De<input class="input" name="inicio" type="date" required value="${hoje.slice(0,7)}-01"></label>
    <label class="cob-campo">Até<input class="input" name="fim" type="date" required value="${hoje}"></label>
    <label class="cob-campo">Unidade<select class="input" name="unidade"><option value="">Todas as unidades autorizadas</option>${cob.ctx.unidades.map(u=>`<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('')}</select></label>
    <button class="btn primary">Consultar</button></form><div id="relResultado"></div>`;
  ligarSeletor('cobRelatorio');
  const form=raiz.querySelector('#relForm'), saida=raiz.querySelector('#relResultado');
  const atualizar=async()=>{
    saida.innerHTML=aviso('Carregando…');
    const query=new URLSearchParams(dadosForm(form));
    try {
      const r=await apiCob(`/api/cobranca/o/${org}/relatorio-financeiro?${query}`);
      const indicadores=[
        ['Títulos recebidos',r.titulos_recebidos],['Valor nominal da carteira',reais(r.valor_carteira_centavos)],['Saldo atual em aberto',reais(r.saldo_aberto_centavos)],
        ['Responsáveis trabalhados',r.trabalhados],['Acordos aceitos',r.acordos],['Valor acordado',reais(r.acordado_centavos)],
        ['Pagamentos confirmados',reais(r.recebidos_centavos)],['Estornos',reais(r.estornos_centavos)],['Recuperação líquida',reais(r.liquido_centavos)],
      ];
      const linhas=r.movimentos.map(m=>[dataBR(m.data),m.tipo==='ESTORNO'?'Estorno':'Pagamento',m.referencia,m.id_origem,m.unidade||'',m.valor_centavos,m.saldo_depois]);
      const cols=['Data','Movimento','Referência','Título','Unidade','Valor','Saldo após movimento'];
      saida.innerHTML=`<div class="cob-indicadores">${indicadores.map(([k,v])=>`<div class="card pad"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
        <div class="card pad"><h3>Conciliação por título</h3><button class="btn" id="relCsv">Exportar CSV</button>
        ${tabelaFinanceira(cols,linhas.map(l=>[...l.slice(0,5).map(esc),reais(l[5]),reais(l[6])]))}</div>`;
      saida.querySelector('#relCsv').onclick=()=>downloadCsv('conciliacao-go-negocia.csv',[cols,...linhas.map(l=>[...l.slice(0,5),l[5]/100,l[6]/100])]);
    } catch(e) { msgErro(saida,e); }
  };
  form.onsubmit=e=>{e.preventDefault();atualizar();};
  await atualizar();
}

// O painel lateral é redesenhado a cada atualização da conversa; se a ficha sumir com os detalhes abertos,
// ela é recriada (com a área Cobrança) sem precisar clicar de novo no nome do contato.
let fichaTimer = null;
const observar = () => {
  const side = document.getElementById('contactSide');
  if (!side) return setTimeout(observar, 800);
  new MutationObserver(() => {
    clearTimeout(fichaTimer);
    fichaTimer = setTimeout(() => {
      const c = B()?.state?.current;
      const aberto = document.querySelector('.inbox')?.classList.contains('show-details');
      if (aberto && c && !c.isGroup && !c.isChannel && side.querySelector('.profile') && !side.querySelector('#fichaAluno')) B().fichaContato();
    }, 250);
  }).observe(side, { childList: true });
};
observar();

window.BalbinoCobranca = { carregarPagina, painelConversa, abrirCaso };
