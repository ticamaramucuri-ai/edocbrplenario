-- Etapa 021: impedimentos individuais por votação e política congelada.
ALTER TABLE "Voting" ADD COLUMN "impedimentPolicyAtOpen" TEXT;

CREATE TABLE "VotingImpediment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "votingId" TEXT NOT NULL,
    "parliamentarianId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedBy" TEXT,
    "revocationReason" TEXT,
    CONSTRAINT "VotingImpediment_votingId_fkey" FOREIGN KEY ("votingId") REFERENCES "Voting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VotingImpediment_parliamentarianId_fkey" FOREIGN KEY ("parliamentarianId") REFERENCES "Parliamentarian" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "VotingImpediment_votingId_revokedAt_idx" ON "VotingImpediment"("votingId", "revokedAt");
CREATE UNIQUE INDEX "VotingImpediment_votingId_parliamentarianId_key" ON "VotingImpediment"("votingId", "parliamentarianId");
