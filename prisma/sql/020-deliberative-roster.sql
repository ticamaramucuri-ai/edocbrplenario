-- Etapa 020: base de votantes congelada na abertura; nulo em votações legadas.
ALTER TABLE "Voting" ADD COLUMN "eligibleVoterIdsAtOpen" TEXT;
