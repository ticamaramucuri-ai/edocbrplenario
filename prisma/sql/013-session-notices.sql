-- Etapa 013: convocação congelada por revisão da pauta.
-- Revisões anteriores permanecem sem comprovante retrospectivo.
BEGIN TRANSACTION;
ALTER TABLE "SessionAgendaRevision" ADD COLUMN "noticeJson" TEXT;
ALTER TABLE "SessionAgendaRevision" ADD COLUMN "noticeSha256" TEXT;
COMMIT;
