export const id = '003_acordos_pagamentos';
export const up = `
ALTER TABLE organizacoes ADD COLUMN desconto_max_bp INTEGER NOT NULL DEFAULT 0 CHECK(desconto_max_bp BETWEEN 0 AND 9999);
ALTER TABLE organizacoes ADD COLUMN parcelas_max INTEGER NOT NULL DEFAULT 1 CHECK(parcelas_max BETWEEN 1 AND 60);
ALTER TABLE organizacoes ADD COLUMN entrada_min_bp INTEGER NOT NULL DEFAULT 0 CHECK(entrada_min_bp BETWEEN 0 AND 10000);

CREATE TABLE acordos(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  titulo_id TEXT NOT NULL REFERENCES titulos(id),
  caso_id TEXT NOT NULL REFERENCES casos(id),
  saldo_base INTEGER NOT NULL,
  total_centavos INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('REVISAO','PROPOSTA','ACEITO','QUITADO','CANCELADO')),
  entrada_centavos INTEGER NOT NULL,
  parcelas INTEGER NOT NULL,
  primeiro_vencimento TEXT NOT NULL,
  criado_por TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  aprovado_por TEXT,
  aceito_por TEXT,
  aceito_em INTEGER,
  prova_aceite TEXT
) STRICT;
CREATE UNIQUE INDEX acordo_aberto_por_titulo ON acordos(titulo_id) WHERE status IN ('REVISAO','PROPOSTA','ACEITO');
CREATE INDEX acordos_escola ON acordos(organizacao_id, criado_em);

CREATE TABLE parcelas_acordo(
  acordo_id TEXT NOT NULL REFERENCES acordos(id),
  numero INTEGER NOT NULL,
  vencimento TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL,
  PRIMARY KEY(acordo_id,numero)
) STRICT;

CREATE TABLE movimentos_financeiros(
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  titulo_id TEXT NOT NULL REFERENCES titulos(id),
  acordo_id TEXT REFERENCES acordos(id),
  referencia TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('PAGAMENTO','ESTORNO')),
  valor_centavos INTEGER NOT NULL CHECK(valor_centavos > 0),
  data TEXT NOT NULL,
  estorna_id TEXT REFERENCES movimentos_financeiros(id),
  saldo_antes INTEGER NOT NULL,
  saldo_depois INTEGER NOT NULL,
  usuario_id TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  UNIQUE(organizacao_id,referencia)
) STRICT;
CREATE INDEX movimentos_estorno ON movimentos_financeiros(estorna_id) WHERE estorna_id IS NOT NULL;
CREATE INDEX movimentos_escola_data ON movimentos_financeiros(organizacao_id,data);
CREATE INDEX movimentos_titulo ON movimentos_financeiros(titulo_id);
CREATE INDEX movimentos_acordo ON movimentos_financeiros(acordo_id);
`;
export const down = `
DROP TABLE movimentos_financeiros;
DROP TABLE parcelas_acordo;
DROP TABLE acordos;
ALTER TABLE organizacoes DROP COLUMN entrada_min_bp;
ALTER TABLE organizacoes DROP COLUMN parcelas_max;
ALTER TABLE organizacoes DROP COLUMN desconto_max_bp;
`;
