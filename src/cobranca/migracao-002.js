// Migração 002 — módulos liberados por usuário.
// Sem linha para o usuário: Mensagens liberado (comportamento atual) e Cobrança conforme os acessos por escola.
export const id = '002_modulos_usuario';
export const up = `
CREATE TABLE modulos_usuario(
  usuario_id TEXT PRIMARY KEY,
  atendimento INTEGER NOT NULL DEFAULT 1 CHECK(atendimento IN (0,1)),
  cobranca INTEGER NOT NULL DEFAULT 1 CHECK(cobranca IN (0,1)),
  atualizado_por TEXT,
  atualizado_em INTEGER NOT NULL
) STRICT;
`;
export const down = `DROP TABLE IF EXISTS modulos_usuario;`;
