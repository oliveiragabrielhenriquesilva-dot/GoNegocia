import { createHash } from 'node:crypto';
import { auditar, executar, novoId, transacao, um, varios } from './db.js';
import { casoVisivel, ErroHttp, filtroUnidade } from './escopo.js';
import { estadoTitulo, exigirTrava, resumoCarteira } from './carteira.js';
import { lerPlanilha } from './planilha.js';
import { dataValida, hoje, normalizarData, paraCentavos, semAcento } from './util.js';

const erro = (msg, status = 400) => new ErroHttp(status, msg);

function inteiro(valor, min, max, campo) {
  if (!Number.isSafeInteger(valor) || valor < min || valor > max) throw erro(campo + ' inválido');
  return valor;
}

function tituloVisivel(e, campo, valor) {
  const f = filtroUnidade(e, 'unidade_id');
  const t = um(`SELECT * FROM titulos WHERE organizacao_id=? AND ${campo}=? AND ${f.sql}`, e.org.id, valor, ...f.params);
  if (!t) throw erro('Título não encontrado', 404);
  return t;
}

export function regras(e) {
  return um('SELECT desconto_max_bp, parcelas_max, entrada_min_bp FROM organizacoes WHERE id=?', e.org.id);
}

export function salvarRegras(e, u, b) {
  if (!e.todasUnidades) throw erro('A configuração exige acesso a todas as unidades', 403);
  const desconto = inteiro(b.desconto_max_bp, 0, 9999, 'Desconto máximo');
  const parcelas = inteiro(b.parcelas_max, 1, 60, 'Limite de parcelas');
  const entrada = inteiro(b.entrada_min_bp, 0, 10000, 'Entrada mínima');
  return transacao(() => {
    executar('UPDATE organizacoes SET desconto_max_bp=?, parcelas_max=?, entrada_min_bp=? WHERE id=?', desconto, parcelas, entrada, e.org.id);
    auditar({ usuarioId:u.id, organizacaoId:e.org.id, acao:'REGRAS_NEGOCIACAO', alvoTipo:'organizacao', alvoId:e.org.id, detalhes:{ desconto, parcelas, entrada } });
    return regras(e);
  });
}

function elegivel(t, e) {
  const s = estadoTitulo(t, e.org);
  if (!s.negociavel || t.saldo_centavos <= 0 || s.idade_saldo_dias > e.org.dias_saldo_valido) {
    throw erro('Título indisponível para negociação. Confira a situação e atualize o saldo com a escola.', 409);
  }
}

function dataParcela(data, meses) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const maxDia = new Date(Date.UTC(ano, mes + meses, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1 + meses, Math.min(dia, maxDia))).toISOString().slice(0, 10);
}

export function criarAcordo(e, u, casoId, b) {
  return transacao(() => {
    const c = casoVisivel(e, casoId);
    exigirTrava(e, u, c);
    const t = tituloVisivel(e, 'id', String(b.titulo_id || ''));
    if (c.status !== 'ABERTO') throw erro('Abra o caso antes de negociar', 409);
    if (c.responsavel_id !== t.responsavel_id) throw erro('Título fora deste caso', 404);
    elegivel(t, e);
    if (um("SELECT id FROM acordos WHERE titulo_id=? AND status IN ('REVISAO','PROPOSTA','ACEITO')", t.id)) throw erro('Já existe acordo em andamento para este título', 409);
    const total = inteiro(b.total_centavos, 1, t.saldo_centavos, 'Valor do acordo');
    const entrada = inteiro(b.entrada_centavos ?? 0, 0, total, 'Entrada');
    const n = inteiro(b.parcelas, 1, 60, 'Quantidade de parcelas');
    const primeira = b.primeiro_vencimento;
    if (typeof primeira !== 'string' || !dataValida(primeira) || primeira < hoje()) throw erro('Informe uma data inicial válida a partir de hoje');
    if (entrada === total ? n !== 1 : total - entrada < n) throw erro('O valor restante precisa cobrir todas as parcelas');
    const r = regras(e);
    const excecao = (t.saldo_centavos - total) / t.saldo_centavos * 10000 > r.desconto_max_bp ||
      n + (entrada > 0 && entrada < total ? 1 : 0) > r.parcelas_max || entrada / total * 10000 < r.entrada_min_bp;
    const id = novoId('aco'), status = excecao ? 'REVISAO' : 'PROPOSTA';
    executar(`INSERT INTO acordos(id,organizacao_id,titulo_id,caso_id,saldo_base,total_centavos,status,entrada_centavos,parcelas,primeiro_vencimento,criado_por,criado_em)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id,e.org.id,t.id,c.id,t.saldo_centavos,total,status,entrada,n,primeira,u.id,Date.now());
    const inserir = (num, mes, valor) => executar('INSERT INTO parcelas_acordo VALUES(?,?,?,?)', id,num,dataParcela(primeira,mes),valor);
    const saldo = total - entrada;
    if (entrada) inserir(saldo ? 0 : 1,0,entrada);
    if (saldo) {
      const base = Math.floor(saldo / n), sobra = saldo % n;
      for (let i = 0; i < n; i++) inserir(i+1,i+(entrada ? 1 : 0),base+(i < sobra ? 1 : 0));
    }
    auditar({ usuarioId:u.id, organizacaoId:e.org.id, acao:'ACORDO_CRIADO', alvoTipo:'acordo', alvoId:id, detalhes:{ titulo:t.id, status, total, entrada, n } });
    return { id, status };
  });
}

function valorRecebido(acordoId) {
  return um(`SELECT COALESCE(SUM(CASE WHEN tipo='PAGAMENTO' THEN valor_centavos ELSE -valor_centavos END),0) total
    FROM movimentos_financeiros WHERE acordo_id=?`, acordoId).total;
}

export function listarAcordos(e, { casoId = null, pagina = 1 } = {}) {
  if (casoId) casoVisivel(e, casoId);
  const f = filtroUnidade(e, 't.unidade_id');
  const offset = (pagina - 1) * 50;
  return varios(`SELECT a.id,a.caso_id,a.status,a.total_centavos,a.criado_em,a.aceito_em,t.id_origem,r.nome responsavel,un.nome unidade
    FROM acordos a JOIN titulos t ON t.id=a.titulo_id JOIN responsaveis r ON r.id=t.responsavel_id LEFT JOIN unidades un ON un.id=t.unidade_id
    WHERE a.organizacao_id=? AND ${f.sql} ${casoId ? 'AND a.caso_id=?' : ''}
    ORDER BY a.criado_em DESC,a.id LIMIT 50 OFFSET ?`, e.org.id,...f.params,...(casoId ? [casoId] : []),offset).map(a => {
    const recebido = valorRecebido(a.id);
    let restante = recebido;
    const parcelas = varios('SELECT numero,vencimento,valor_centavos FROM parcelas_acordo WHERE acordo_id=? ORDER BY numero', a.id).map(p => {
      const pago = Math.min(restante,p.valor_centavos);
      restante -= pago;
      return { ...p, pago_centavos:pago };
    });
    return { ...a, recebido_centavos:recebido, parcelas };
  });
}

export function mudarAcordo(e, u, id, b) {
  return transacao(() => {
    const a = um('SELECT * FROM acordos WHERE id=? AND organizacao_id=?', id,e.org.id);
    if (!a) throw erro('Acordo não encontrado', 404);
    const t = tituloVisivel(e, 'id', a.titulo_id);
    const c = casoVisivel(e, a.caso_id);
    const podeAprovar = e.pode('fila.distribuir');
    let status;
    if (b.acao === 'aprovar' && a.status === 'REVISAO') {
      if (!podeAprovar) throw erro('Só um supervisor ou administrador pode aprovar exceções', 403);
      status = 'PROPOSTA';
    } else if (b.acao === 'aceitar' && a.status === 'PROPOSTA') {
      exigirTrava(e,u,c);
      if (!um('SELECT 1 FROM vinculos_conversa WHERE organizacao_id=? AND caso_id=? AND verificada_em IS NOT NULL',e.org.id,c.id)) {
        throw erro('Confirme a identidade do responsável na conversa antes de registrar o aceite',409);
      }
      const prova = String(b.prova || '').trim();
      if (!prova || prova.length > 500) throw erro('Informe a referência do aceite do responsável (até 500 caracteres)');
      if (a.primeiro_vencimento < hoje()) throw erro('A proposta venceu. Cancele e crie outra.', 409);
      executar('UPDATE acordos SET aceito_em=?, aceito_por=?, prova_aceite=? WHERE id=?', Date.now(),u.id,prova,id);
      status = 'ACEITO';
    } else if (b.acao === 'cancelar' && ['REVISAO','PROPOSTA','ACEITO'].includes(a.status)) {
      if (!podeAprovar) exigirTrava(e,u,c);
      if (a.status === 'ACEITO' && (!podeAprovar || um('SELECT 1 FROM movimentos_financeiros WHERE acordo_id=?', id))) throw erro('Acordo aceito só pode ser cancelado por supervisor antes de registrar pagamentos', 409);
      status = 'CANCELADO';
    } else throw erro('Ação incompatível com o estado do acordo', 409);
    if (status !== 'CANCELADO') {
      if (c.status !== 'ABERTO') throw erro('Abra o caso antes de negociar',409);
      elegivel(t, e);
      if (t.saldo_centavos !== a.saldo_base) throw erro('O saldo mudou. Cancele esta proposta e confira o título.', 409);
    }
    executar('UPDATE acordos SET status=?,aprovado_por=COALESCE(?,aprovado_por) WHERE id=?',status,b.acao === 'aprovar' ? u.id : null,id);
    auditar({ usuarioId:u.id, organizacaoId:e.org.id, acao:'ACORDO_STATUS', alvoTipo:'acordo', alvoId:id, detalhes:{ anterior:a.status, status } });
    return { id,status };
  });
}

function registrarMovimento(e,u,b) {
  const t = tituloVisivel(e,'id_origem',b.id_titulo);
  const anterior = um('SELECT * FROM movimentos_financeiros WHERE organizacao_id=? AND referencia=?',e.org.id,b.referencia);
  const original = b.tipo === 'ESTORNO' ? um("SELECT * FROM movimentos_financeiros WHERE organizacao_id=? AND referencia=? AND tipo='PAGAMENTO'",e.org.id,b.estorna) : null;
  if (b.tipo === 'ESTORNO' && (!original || original.titulo_id !== t.id || original.data > b.data)) throw erro('Estorno deve corresponder a um pagamento anterior do mesmo título');
  if (anterior) {
    if (anterior.titulo_id === t.id && anterior.tipo === b.tipo && anterior.valor_centavos === b.valor && anterior.data === b.data && anterior.estorna_id === (original?.id ?? null)) return { status:'REPETIDO' };
    throw erro('Referência já usada com outros dados',409);
  }
  if (t.situacao === 'CANCELADO') throw erro('Título cancelado',409);
  const ultimo = um('SELECT MAX(data) data FROM movimentos_financeiros WHERE titulo_id=?',t.id).data;
  if (b.data < t.saldo_referencia || (ultimo && b.data < ultimo)) throw erro('Movimento anterior à referência do saldo ou a outro lançamento. Concilie com a escola.',409);
  if (original) {
    const revertido = um('SELECT COALESCE(SUM(valor_centavos),0) total FROM movimentos_financeiros WHERE estorna_id=?',original.id).total;
    if (revertido + b.valor > original.valor_centavos) throw erro('Estorno acima do valor ainda não estornado',409);
  }
  const a = original
    ? (original.acordo_id && um('SELECT * FROM acordos WHERE id=?', original.acordo_id))
    : um("SELECT * FROM acordos WHERE titulo_id=? AND status='ACEITO'",t.id);
  if (original && !a && um("SELECT 1 FROM acordos WHERE titulo_id=? AND status IN ('ACEITO','QUITADO') AND aceito_em>=?",t.id,original.criado_em)) throw erro('Estorno exige conciliar o acordo aceito depois deste pagamento',409);
  if (original && a && a.status === 'QUITADO' && um("SELECT 1 FROM acordos WHERE titulo_id=? AND id<>? AND status IN ('REVISAO','PROPOSTA','ACEITO')",t.id,a.id)) throw erro('Existe outro acordo em andamento para este título',409);
  const recebido = a ? valorRecebido(a.id) : 0;
  const delta = original ? -b.valor : b.valor;
  if (!original && (b.valor > t.saldo_centavos || (a && recebido + b.valor > a.total_centavos))) throw erro('Valor acima do saldo pendente',409);
  const quitado = a && recebido + delta === a.total_centavos;
  const desconto = a ? a.saldo_base - a.total_centavos : 0;
  const ajuste = desconto * (Number(!!quitado) - Number(a?.status === 'QUITADO'));
  const saldo = t.saldo_centavos - delta - ajuste;
  if (saldo < 0 || !Number.isSafeInteger(saldo)) throw erro('Saldo divergente. Concilie com a escola.',409);
  const id = novoId('mov'), agora = Date.now();
  executar(`INSERT INTO movimentos_financeiros VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,e.org.id,t.id,a?.id ?? null,b.referencia,b.tipo,b.valor,b.data,original?.id ?? null,t.saldo_centavos,saldo,u.id,agora);
  executar('UPDATE titulos SET saldo_centavos=?,situacao=?,atualizado_em=? WHERE id=?',saldo,saldo ? 'ABERTO' : 'PAGO',agora,t.id);
  if (a) executar('UPDATE acordos SET status=? WHERE id=?',quitado ? 'QUITADO' : 'ACEITO',a.id);
  executar("INSERT INTO titulo_historico(organizacao_id,titulo_id,usuario_id,campo,de,para,em) VALUES(?,?,?,'saldo_centavos',?,?,?)",e.org.id,t.id,u.id,String(t.saldo_centavos),String(saldo),agora);
  auditar({ usuarioId:u.id, organizacaoId:e.org.id, acao:b.tipo, alvoTipo:'titulo', alvoId:t.id, detalhes:{ referencia:b.referencia, valor:b.valor, saldo, movimento_id:id } });
  return { status:'VALIDO', antes:t.saldo_centavos, depois:saldo };
}

const COLUNAS = ['id_titulo','referencia','tipo','data','valor','estorna'];
export function importarRetorno(e,u,b) {
  if (!e.todasUnidades) throw erro('O retorno exige acesso a todas as unidades da escola',403);
  const arquivo = Buffer.from(String(b.conteudo_base64 || ''),'base64');
  if (!arquivo.length || arquivo.length > 2*1024*1024) throw erro('Selecione um CSV ou XLSX de até 2 MB');
  let tabela;
  try { tabela=lerPlanilha(arquivo,String(b.arquivo_nome || '')); } catch { throw erro('Não foi possível ler a planilha'); }
  if (tabela.length < 2 || tabela.length > 1001) throw erro('Informe entre 1 e 1.000 movimentos');
  const header = tabela[0].map(semAcento);
  const indices = COLUNAS.map(c => header.indexOf(c));
  if (indices.slice(0,5).includes(-1) || new Set(header).size !== header.length) throw erro('Use as colunas id_titulo, referencia, tipo, data, valor e estorna');
  const previa = Symbol('previa');
  let resultado;
  try {
    return transacao(() => {
      const linhas = tabela.slice(1).map((row,i) => {
        const mov = Object.fromEntries(COLUNAS.map((c,j)=>[c,String(row[indices[j]] ?? '').trim()]));
        mov.tipo=mov.tipo.toUpperCase();
        mov.data=/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{5}(?:\.\d+)?)$/.test(mov.data) ? normalizarData(mov.data) : null;
        mov.valor=paraCentavos(mov.valor);
        const item={ linha:i+2,id_titulo:mov.id_titulo,referencia:mov.referencia };
        try {
          if (!mov.id_titulo || mov.id_titulo.length>150 || !mov.referencia || mov.referencia.length>150 ||
            !['PAGAMENTO','ESTORNO'].includes(mov.tipo) || !mov.data || mov.data>hoje() ||
            !Number.isSafeInteger(mov.valor) || mov.valor<=0 || (mov.tipo==='PAGAMENTO' && mov.estorna)) throw erro('Dados do movimento inválidos');
          return { ...item,...registrarMovimento(e,u,mov) };
        } catch (ex) {
          if (!(ex instanceof ErroHttp)) throw ex;
          return { ...item,status:'REJEITADO',motivo:ex.message };
        }
      });
      const token=createHash('sha256').update(e.org.id).update(arquivo).update(JSON.stringify(linhas)).digest('hex');
      const rejeitados=linhas.filter(l=>l.status==='REJEITADO').length;
      resultado={ token,linhas,rejeitados,validos:linhas.filter(l=>l.status==='VALIDO').length };
      if (!b.token) throw previa;
      if (b.token!==token) throw erro('A carteira mudou. Gere uma nova prévia antes de aplicar.',409);
      if (rejeitados) throw erro('Corrija todas as linhas rejeitadas antes de aplicar',409);
      return resultado;
    });
  } catch (ex) {
    if (ex === previa) return resultado;
    throw ex;
  }
}

export function relatorioFinanceiro(e, inicio, fim, unidade) {
  if (!dataValida(inicio) || !dataValida(fim) || inicio>fim) throw erro('Período inválido');
  if (unidade && !e.todasUnidades && !e.unidades.includes(unidade)) throw erro('Unidade não encontrada',404);
  const escopo = unidade ? { ...e,todasUnidades:false,unidades:[unidade] } : e;
  const f = filtroUnidade(escopo,'t.unidade_id');
  if (unidade && !um('SELECT 1 FROM unidades WHERE id=? AND organizacao_id=?',unidade,e.org.id)) throw erro('Unidade não encontrada',404);
  const carteira = um(`SELECT COUNT(*) titulos_recebidos,COALESCE(SUM(t.valor_centavos),0) valor_carteira_centavos FROM titulos t WHERE t.organizacao_id=? AND ${f.sql}`,e.org.id,...f.params);
  const params = [e.org.id,inicio,fim,...f.params];
  const movimentos = varios(`SELECT m.data,m.tipo,m.referencia,m.valor_centavos,m.saldo_depois,t.id_origem,un.nome unidade
    FROM movimentos_financeiros m JOIN titulos t ON t.id=m.titulo_id LEFT JOIN unidades un ON un.id=t.unidade_id
    WHERE m.organizacao_id=? AND m.data BETWEEN ? AND ? AND ${f.sql} ORDER BY m.data,m.criado_em,m.rowid`,...params);
  const eventos = varios(`SELECT a.aceito_em,a.total_centavos FROM acordos a JOIN titulos t ON t.id=a.titulo_id
    WHERE a.organizacao_id=? AND a.aceito_em IS NOT NULL AND ${f.sql}`,e.org.id,...f.params).filter(a=>hoje(a.aceito_em)>=inicio && hoje(a.aceito_em)<=fim);
  const recebidos = movimentos.reduce((s,m)=>s+(m.tipo==='PAGAMENTO'?m.valor_centavos:0),0);
  const estornos = movimentos.reduce((s,m)=>s+(m.tipo==='ESTORNO'?m.valor_centavos:0),0);
  const trabalhados = um(`SELECT COUNT(DISTINCT c.responsavel_id) n FROM contatos ct JOIN casos c ON c.id=ct.caso_id
    WHERE ct.organizacao_id=? AND ct.em>=? AND ct.em<? AND EXISTS(SELECT 1 FROM titulos t WHERE t.responsavel_id=c.responsavel_id AND t.organizacao_id=c.organizacao_id AND ${f.sql})`,
    e.org.id,Date.parse(inicio+'T00:00:00-03:00'),Date.parse(fim+'T00:00:00-03:00')+86400000,...f.params).n;
  return { ...resumoCarteira(escopo), ...carteira, trabalhados, acordos:eventos.length, acordado_centavos:eventos.reduce((s,a)=>s+a.total_centavos,0),
    recebidos_centavos:recebidos, estornos_centavos:estornos, liquido_centavos:recebidos-estornos,movimentos };
}
