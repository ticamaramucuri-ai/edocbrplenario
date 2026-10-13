CREATE TABLE "DisplayState" (
  "sessionId" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "mode" TEXT NOT NULL DEFAULT 'live',
  "manualProfile" TEXT,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DisplayState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DisplayState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DisplayState_tenantId_updatedAt_idx" ON "DisplayState"("tenantId", "updatedAt");
