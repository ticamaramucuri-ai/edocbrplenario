-- Etapa 014: destinatários e ciência vinculados à revisão da convocação.
-- Sem retroatividade: revisões emitidas antes desta migração ficam sem lista.
BEGIN TRANSACTION;
CREATE TABLE "SessionNoticeRecipient" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "parliamentarianId" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL,
  "noticeSha256" TEXT NOT NULL,
  "issuedAt" DATETIME NOT NULL,
  "acknowledgedAt" DATETIME,
  "ackActorId" TEXT,
  CONSTRAINT "SessionNoticeRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionNoticeRecipient_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SessionNoticeRecipient_sessionId_revision_parliamentarianId_key" ON "SessionNoticeRecipient"("sessionId", "revision", "parliamentarianId");
CREATE INDEX "SessionNoticeRecipient_tenantId_parliamentarianId_issuedAt_idx" ON "SessionNoticeRecipient"("tenantId", "parliamentarianId", "issuedAt");
CREATE INDEX "SessionNoticeRecipient_tenantId_sessionId_revision_idx" ON "SessionNoticeRecipient"("tenantId", "sessionId", "revision");
COMMIT;
