-- CreateTable
CREATE TABLE "SessionRecording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'verified',
    "version" INTEGER NOT NULL DEFAULT 1,
    "manifestJson" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "replaySha256" TEXT NOT NULL,
    "replayBytes" BIGINT NOT NULL,
    "durationSeconds" REAL NOT NULL,
    "gapCount" INTEGER NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionRecording_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionRecording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordingCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordingId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordingCommand_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "SessionRecording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecording_sessionId_key" ON "SessionRecording"("sessionId");

-- CreateIndex
CREATE INDEX "SessionRecording_tenantId_status_idx" ON "SessionRecording"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingCommand_recordingId_idempotencyKey_key" ON "RecordingCommand"("recordingId", "idempotencyKey");
