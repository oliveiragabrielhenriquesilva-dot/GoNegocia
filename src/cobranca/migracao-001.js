// Cobrança escolar (módulo GO Negocia dentro do Balbino Chat) — migração 001.
// Banco próprio (data/cobranca.sqlite): nada aqui altera o banco principal do Balbino.
// Usuários, contatos, conexões e conversas continuam sendo os do Balbino; aqui ficam só IDs de referência
// (usuario_id = users[].id, instance_id = connections[].id, contact_id = contacts[].id, conversation_id = conversations[].id).
// Valores em centavos; datas de negócio 'AAAA-MM-DD'; instantes em ms.

export const id = '001_cobranca_base';

export const up = `
CREATE TABLE organizacoes(
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'EDUCACAO',
  regra_verificacao TEXT NOT NULL DEFAULT 'MATRICULA_ALUNO',
  dias_saldo_valido INTEGER NOT NULL DEFAULT 7,
  ativa INTEGER NOT NULL DEFAULT 1,
  criada_em INTEGER NOT NULL
) STRICT;

CREATE TABLE unidades(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  nome TEXT NOT NULL,
  codigo TEXT NOT NULL,
  ativa INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organizacao_id, codigo)
) STRICT;

-- Acesso explícito do usuário do Balbino a cada instituição. Sem linha aqui, não vê a cobrança da instituição.
-- (O SUPER_ADMIN do Balbino administra a cobrança de todas.)
CREATE TABLE acessos(
  usuario_id TEXT NOT NULL,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  papel TEXT NOT NULL CHECK(papel IN ('SUPERVISOR','ATENDENTE','REPRESENTANTE')),
  todas_unidades INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(usuario_id, organizacao_id)
) STRICT;

CREATE TABLE acesso_unidades(
  usuario_id TEXT NOT NULL,
  organizacao_id TEXT NOT NULL,
  unidade_id TEXT NOT NULL REFERENCES unidades(id),
  PRIMARY KEY(usuario_id, organizacao_id, unidade_id),
  FOREIGN KEY(usuario_id, organizacao_id) REFERENCES acessos(usuario_id, organizacao_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE responsaveis(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  chave_origem TEXT NOT NULL,
  nome TEXT NOT NULL,
  documento_final TEXT,
  telefone TEXT,
  contato_autorizado INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL,
  UNIQUE(organizacao_id, chave_origem)
) STRICT;
CREATE INDEX idx_resp_org_tel ON responsaveis(organizacao_id, telefone);

CREATE TABLE alunos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  matricula TEXT NOT NULL,
  nome TEXT,
  unidade_id TEXT REFERENCES unidades(id),
  UNIQUE(organizacao_id, matricula)
) STRICT;

CREATE TABLE vinculos(
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  responsavel_id TEXT NOT NULL REFERENCES responsaveis(id),
  aluno_id TEXT NOT NULL REFERENCES alunos(id),
  PRIMARY KEY(responsavel_id, aluno_id)
) STRICT;

CREATE TABLE lotes(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('CARTEIRA','RETORNO')),
  escopo TEXT NOT NULL DEFAULT 'COMPLETA' CHECK(escopo IN ('COMPLETA','PARCIAL')),
  arquivo_nome TEXT NOT NULL,
  arquivo_hash TEXT NOT NULL,
  data_referencia TEXT NOT NULL,
  usuario_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PREVIA','APLICADO','DESCARTADO')),
  resumo TEXT NOT NULL DEFAULT '{}',
  criado_em INTEGER NOT NULL,
  aplicado_em INTEGER
) STRICT;
CREATE INDEX idx_lotes_org ON lotes(organizacao_id, criado_em);

CREATE TABLE lote_linhas(
  lote_id TEXT NOT NULL REFERENCES lotes(id),
  linha INTEGER NOT NULL,
  status TEXT NOT NULL,
  motivo TEXT,
  dados TEXT NOT NULL,
  PRIMARY KEY(lote_id, linha)
) STRICT;

CREATE TABLE titulos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  id_origem TEXT NOT NULL,
  unidade_id TEXT REFERENCES unidades(id),
  responsavel_id TEXT NOT NULL REFERENCES responsaveis(id),
  aluno_id TEXT NOT NULL REFERENCES alunos(id),
  competencia TEXT,
  vencimento TEXT NOT NULL,
  valor_centavos INTEGER,
  saldo_centavos INTEGER NOT NULL,
  situacao TEXT NOT NULL CHECK(situacao IN ('ABERTO','PAGO','CANCELADO')),
  bloqueio TEXT CHECK(bloqueio IS NULL OR bloqueio IN ('CONTESTADO','COMPROVANTE_EM_ANALISE')),
  saldo_referencia TEXT NOT NULL,
  ausente_desde_lote TEXT REFERENCES lotes(id),
  ultimo_lote_id TEXT REFERENCES lotes(id),
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL,
  UNIQUE(organizacao_id, id_origem)
) STRICT;
CREATE INDEX idx_titulos_resp ON titulos(organizacao_id, responsavel_id);

CREATE TABLE titulo_historico(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organizacao_id TEXT NOT NULL,
  titulo_id TEXT NOT NULL REFERENCES titulos(id),
  lote_id TEXT REFERENCES lotes(id),
  usuario_id TEXT,
  campo TEXT NOT NULL,
  de TEXT,
  para TEXT,
  em INTEGER NOT NULL
) STRICT;

-- Conexão do Balbino -> instituição. Uma conexão serve no máximo uma instituição.
-- modo_envio TESTE: o contato ativo grava a mensagem como simulada e nunca chama o WhatsApp.
CREATE TABLE conexoes(
  instance_id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  modo_envio TEXT NOT NULL DEFAULT 'TESTE' CHECK(modo_envio IN ('TESTE','REAL')),
  criada_em INTEGER NOT NULL
) STRICT;

-- Um caso por responsável financeiro por instituição: ativo e receptivo trabalham o mesmo caso.
CREATE TABLE casos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  responsavel_id TEXT NOT NULL REFERENCES responsaveis(id),
  status TEXT NOT NULL DEFAULT 'ABERTO' CHECK(status IN ('ABERTO','PAUSADO','ENCERRADO')),
  atendente_id TEXT,
  proxima_acao_em TEXT,
  proxima_acao_tipo TEXT,
  proxima_acao_nota TEXT,
  retorno_combinado_em INTEGER,
  trava_usuario_id TEXT,
  trava_ate INTEGER,
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL,
  UNIQUE(organizacao_id, responsavel_id)
) STRICT;

CREATE TABLE contatos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  caso_id TEXT NOT NULL REFERENCES casos(id),
  usuario_id TEXT NOT NULL,
  canal TEXT NOT NULL CHECK(canal IN ('WHATSAPP','TELEFONE','EMAIL','PRESENCIAL')),
  direcao TEXT NOT NULL CHECK(direcao IN ('ATIVO','RECEPTIVO')),
  resultado TEXT NOT NULL CHECK(resultado IN ('SEM_RESPOSTA','RESPONDEU','RETORNO_COMBINADO','PROMESSA','RECUSA','NUMERO_INVALIDO','OUTRO')),
  nota TEXT,
  promessa_data TEXT,
  promessa_centavos INTEGER,
  retorno_em INTEGER,
  conversation_id TEXT,
  em INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_contatos_caso ON contatos(caso_id, em);

-- Vínculo entre o contato do Balbino NUMA conexão e um caso de UMA instituição.
-- Chave: (conexão, contato, instituição) — o mesmo telefone em duas escolas gera vínculos separados.
-- caso_id/verificada_em só são preenchidos pela confirmação de identidade (nunca pelo telefone).
CREATE TABLE vinculos_conversa(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  instance_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  caso_id TEXT REFERENCES casos(id),
  origem TEXT NOT NULL CHECK(origem IN ('CONEXAO','ASSOCIACAO_MANUAL','CONTATO_ATIVO')),
  verificada_em INTEGER,
  verificada_por TEXT,
  ultima_conversation_id TEXT,
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL,
  UNIQUE(instance_id, contact_id, organizacao_id)
) STRICT;

-- Pendência do Balbino (pendencias[].id) ligada ao caso e aos títulos afetados.
-- Concluir a pendência no Balbino NÃO libera nem quita títulos: liberar é ação própria da cobrança.
CREATE TABLE pendencias_cobranca(
  pendencia_id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  caso_id TEXT NOT NULL REFERENCES casos(id),
  motivo TEXT NOT NULL CHECK(motivo IN ('CONTESTACAO','COMPROVANTE','CONDICAO_EXCECAO')),
  titulos TEXT NOT NULL DEFAULT '[]',
  status_cobranca TEXT NOT NULL DEFAULT 'TITULOS_PAUSADOS' CHECK(status_cobranca IN ('TITULOS_PAUSADOS','SEM_PAUSA','TITULOS_LIBERADOS')),
  criada_por TEXT NOT NULL,
  criada_em INTEGER NOT NULL,
  liberada_por TEXT,
  liberada_em INTEGER
) STRICT;

CREATE TABLE auditoria(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  em INTEGER NOT NULL,
  usuario_id TEXT,
  organizacao_id TEXT,
  acao TEXT NOT NULL,
  alvo_tipo TEXT,
  alvo_id TEXT,
  detalhes TEXT
) STRICT;
CREATE INDEX idx_auditoria_org ON auditoria(organizacao_id, em);
`;

export const down = `
DROP TABLE IF EXISTS auditoria;
DROP TABLE IF EXISTS pendencias_cobranca;
DROP TABLE IF EXISTS vinculos_conversa;
DROP TABLE IF EXISTS contatos;
DROP TABLE IF EXISTS casos;
DROP TABLE IF EXISTS conexoes;
DROP TABLE IF EXISTS titulo_historico;
DROP TABLE IF EXISTS titulos;
DROP TABLE IF EXISTS lote_linhas;
DROP TABLE IF EXISTS lotes;
DROP TABLE IF EXISTS vinculos;
DROP TABLE IF EXISTS alunos;
DROP TABLE IF EXISTS responsaveis;
DROP TABLE IF EXISTS acesso_unidades;
DROP TABLE IF EXISTS acessos;
DROP TABLE IF EXISTS unidades;
DROP TABLE IF EXISTS organizacoes;
`;
