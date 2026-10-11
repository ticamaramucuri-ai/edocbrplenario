-- Etapa 019: quórum aplicável à votação e base da maioria absoluta.
ALTER TABLE "Voting" ADD COLUMN "requiredQuorum" INTEGER;
ALTER TABLE "Voting" ADD COLUMN "memberBaseAtOpen" INTEGER;
