-- Etapa 017: chave de idempotência de notificações automáticas.
BEGIN TRANSACTION;
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_tenantId_dedupeKey_key" ON "Notification"("tenantId", "dedupeKey");
INSERT OR IGNORE INTO "ScheduledJob" ("id", "kind", "title", "everySeconds", "nextRunAt", "active", "createdAt")
VALUES ('notice-deadline-alerts-job', 'notice.deadline_alerts', 'Avisos de prazo de convocação', 300,
  CAST(strftime('%s','now') AS INTEGER) * 1000, 1, CAST(strftime('%s','now') AS INTEGER) * 1000);
COMMIT;
