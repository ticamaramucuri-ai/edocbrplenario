-- Pacote emitido para um desktop designado e confirmação assinada de importação.
-- Não concede autoridade de sessão.
CREATE TABLE "LocalSessionTransferIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "artifactHashesJson" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    CONSTRAINT "LocalSessionTransferIssue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocalSessionTransferIssue_tenantId_deviceId_revisionId_manifestSha256_key"
    ON "LocalSessionTransferIssue"("tenantId", "deviceId", "revisionId", "manifestSha256");
CREATE INDEX "LocalSessionTransferIssue_tenantId_sessionId_issuedAt_idx"
    ON "LocalSessionTransferIssue"("tenantId", "sessionId", "issuedAt");
ALTER TABLE "LocalSessionTransferIssue" ADD CONSTRAINT "LocalSessionTransferIssue_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalSessionTransferIssue" ADD CONSTRAINT "LocalSessionTransferIssue_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "LocalServerDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalSessionTransferIssue" ADD CONSTRAINT "LocalSessionTransferIssue_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
