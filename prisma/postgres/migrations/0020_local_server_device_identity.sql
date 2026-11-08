-- Identidade pública do desktop e designação única por Câmara. Não concede
-- autoridade de sessão; apenas prepara autenticação do download.
ALTER TABLE "AuthSession" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);

CREATE TABLE "LocalServerDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "publicKeySpkiSha256" TEXT NOT NULL,
    "approvalReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "LocalServerDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocalServerDevice_tenantId_publicKeySpkiSha256_key" ON "LocalServerDevice"("tenantId", "publicKeySpkiSha256");
CREATE UNIQUE INDEX "LocalServerDevice_publicKeySpkiSha256_key" ON "LocalServerDevice"("publicKeySpkiSha256");
CREATE INDEX "LocalServerDevice_tenantId_status_idx" ON "LocalServerDevice"("tenantId", "status");
ALTER TABLE "LocalServerDevice" ADD CONSTRAINT "LocalServerDevice_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LocalServerDesignation" (
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LocalServerDesignation_pkey" PRIMARY KEY ("tenantId")
);
ALTER TABLE "LocalServerDesignation" ADD CONSTRAINT "LocalServerDesignation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalServerDesignation" ADD CONSTRAINT "LocalServerDesignation_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "LocalServerDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LocalDeviceRequestNonce" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LocalDeviceRequestNonce_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocalDeviceRequestNonce_tenantId_deviceId_nonceHash_key" ON "LocalDeviceRequestNonce"("tenantId", "deviceId", "nonceHash");
CREATE INDEX "LocalDeviceRequestNonce_expiresAt_idx" ON "LocalDeviceRequestNonce"("expiresAt");
ALTER TABLE "LocalDeviceRequestNonce" ADD CONSTRAINT "LocalDeviceRequestNonce_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalDeviceRequestNonce" ADD CONSTRAINT "LocalDeviceRequestNonce_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "LocalServerDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
