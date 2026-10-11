-- Etapa 011: snapshot da pauta e da política tenant no ato de publicação.
-- Dados publicados antes desta migração não são retroativamente certificados.
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "SessionAgendaRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "agendaJson" TEXT NOT NULL,
  "policyJson" TEXT NOT NULL,
  "actorId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SessionAgendaRevision_sessionId_revision_key" ON "SessionAgendaRevision"("sessionId", "revision");
CREATE INDEX IF NOT EXISTS "SessionAgendaRevision_tenantId_createdAt_idx" ON "SessionAgendaRevision"("tenantId", "createdAt");
COMMIT;
