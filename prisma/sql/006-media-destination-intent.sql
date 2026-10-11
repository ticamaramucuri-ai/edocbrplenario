-- Etapa 006: intenção durável de destinos, sem stream key/URL.
CREATE TABLE IF NOT EXISTS "MediaDestinationIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "transmissionId" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "desiredEnabled" BOOLEAN NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "observedGeneration" INTEGER NOT NULL DEFAULT 0,
  "syncStatus" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "nextAttemptAt" DATETIME,
  "leaseOwner" TEXT,
  "leaseUntil" DATETIME,
  "lastAppliedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MediaDestinationIntent_transmissionId_fkey" FOREIGN KEY ("transmissionId") REFERENCES "Transmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MediaDestinationIntent_transmissionId_destinationId_key" ON "MediaDestinationIntent"("transmissionId", "destinationId");
CREATE INDEX IF NOT EXISTS "MediaDestinationIntent_nextAttemptAt_leaseUntil_idx" ON "MediaDestinationIntent"("nextAttemptAt", "leaseUntil");
