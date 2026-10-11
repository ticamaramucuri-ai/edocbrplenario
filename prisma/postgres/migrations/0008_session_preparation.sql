ALTER TABLE "SessionAgendaRevision" ADD COLUMN "documentManifestJson" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "SessionDocument" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionDocument_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SessionDocument_sessionId_kind_version_key" ON "SessionDocument"("sessionId", "kind", "version");
CREATE INDEX "SessionDocument_tenantId_sessionId_createdAt_idx" ON "SessionDocument"("tenantId", "sessionId", "createdAt");

CREATE TABLE "SessionNoticeDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "parliamentarianId" TEXT NOT NULL,
  "noticeSha256" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "deliveredAt" TIMESTAMP(3) NOT NULL,
  "recordedById" TEXT NOT NULL,
  "recordedByName" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionNoticeDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionNoticeDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionNoticeDelivery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SessionNoticeDelivery_tenantId_commandId_key" ON "SessionNoticeDelivery"("tenantId", "commandId");
CREATE INDEX "SessionNoticeDelivery_tenantId_sessionId_revision_idx" ON "SessionNoticeDelivery"("tenantId", "sessionId", "revision");
