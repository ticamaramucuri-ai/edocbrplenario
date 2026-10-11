-- Etapa 007: singleton operacional, sem dados de tenant ou segredos de destino.
CREATE TABLE IF NOT EXISTS "MediaWorkerHeartbeat" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "lastBeatAt" DATETIME NOT NULL,
  "lastCycleAt" DATETIME,
  "updatedAt" DATETIME NOT NULL
);
