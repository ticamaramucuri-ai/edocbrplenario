-- Contexto deliberativo e versão congelados no ato da publicação da pauta.
-- Revisões anteriores permanecem sem contexto e exigem nova publicação para exportação local.
ALTER TABLE "SessionAgendaRevision" ADD COLUMN "transferContextJson" TEXT;
