-- Reserva uma concessão assinada por sessão. Nenhum voto local é liberado por esta migração.
CREATE TABLE "LocalSessionAuthorityLease" (
    "sessionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "signingKeyId" TEXT NOT NULL,
    "signedGrantJson" TEXT NOT NULL,
    CONSTRAINT "LocalSessionAuthorityLease_pkey" PRIMARY KEY ("sessionId")
);
CREATE INDEX "LocalSessionAuthorityLease_tenantId_expiresAt_idx" ON "LocalSessionAuthorityLease"("tenantId", "expiresAt");
CREATE INDEX "LocalSessionAuthorityLease_tenantId_deviceId_expiresAt_idx" ON "LocalSessionAuthorityLease"("tenantId", "deviceId", "expiresAt");
ALTER TABLE "LocalSessionAuthorityLease" ADD CONSTRAINT "LocalSessionAuthorityLease_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalSessionAuthorityLease" ADD CONSTRAINT "LocalSessionAuthorityLease_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalSessionAuthorityLease" ADD CONSTRAINT "LocalSessionAuthorityLease_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "LocalServerDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
