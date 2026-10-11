ALTER TABLE "Session" ADD COLUMN "official" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN "officialConfigurationId" TEXT;

CREATE TABLE "OfficialConfigurationRevision" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "snapshotSha256" TEXT NOT NULL,
  "approvalReference" TEXT NOT NULL,
  "approvedById" TEXT NOT NULL,
  "approvedByName" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfficialConfigurationRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfficialConfigurationRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OfficialConfigurationRevision_tenantId_version_key" ON "OfficialConfigurationRevision"("tenantId", "version");
CREATE INDEX "OfficialConfigurationRevision_tenantId_approvedAt_idx" ON "OfficialConfigurationRevision"("tenantId", "approvedAt");
