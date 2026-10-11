-- Etapa 003: tabelas aditivas para acompanhamento local da transmissão.
-- A base SQLite piloto ainda não tem histórico Prisma Migrate; aplicar com
-- scripts/apply-sqlite-migration.sh após backup. Não usar db:push em produção.
CREATE TABLE IF NOT EXISTS "Transmission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "startedAt" DATETIME,
  "endedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Transmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Transmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Transmission_sessionId_key" ON "Transmission"("sessionId");
CREATE INDEX IF NOT EXISTS "Transmission_tenantId_status_idx" ON "Transmission"("tenantId", "status");

CREATE TABLE IF NOT EXISTS "TransmissionCommand" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "transmissionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransmissionCommand_transmissionId_fkey" FOREIGN KEY ("transmissionId") REFERENCES "Transmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TransmissionCommand_transmissionId_idempotencyKey_key" ON "TransmissionCommand"("transmissionId", "idempotencyKey");
