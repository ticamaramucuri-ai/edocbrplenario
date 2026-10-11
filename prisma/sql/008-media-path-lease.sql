-- Etapa 008: lease por caminho MediaMTX, sem URLs ou chaves.
CREATE TABLE IF NOT EXISTS "MediaPathLease" (
  "path" TEXT NOT NULL PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "leaseUntil" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
