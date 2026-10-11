-- Etapa 012: motivo e diferença de cada emenda à pauta publicada.
BEGIN TRANSACTION;
ALTER TABLE "SessionAgendaRevision" ADD COLUMN "changeJson" TEXT;
ALTER TABLE "SessionAgendaRevision" ADD COLUMN "justification" TEXT;
COMMIT;
