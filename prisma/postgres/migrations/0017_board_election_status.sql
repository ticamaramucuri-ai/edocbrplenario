-- A Mesa eleita não assume automaticamente antes de confirmar a posse.
ALTER TABLE "BoardPosition" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'confirmed';
