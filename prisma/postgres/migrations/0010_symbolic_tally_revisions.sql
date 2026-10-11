CREATE TABLE "SymbolicTallyRevision" (
  "id" TEXT NOT NULL,
  "votingId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "countsJson" TEXT NOT NULL,
  "proposedById" TEXT NOT NULL,
  "proposedByName" TEXT NOT NULL,
  "confirmedById" TEXT,
  "confirmedByName" TEXT,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "SymbolicTallyRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SymbolicTallyRevision_votingId_fkey" FOREIGN KEY ("votingId") REFERENCES "Voting"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SymbolicTallyRevision_votingId_revision_key" ON "SymbolicTallyRevision"("votingId", "revision");
CREATE INDEX "SymbolicTallyRevision_votingId_proposedAt_idx" ON "SymbolicTallyRevision"("votingId", "proposedAt");
