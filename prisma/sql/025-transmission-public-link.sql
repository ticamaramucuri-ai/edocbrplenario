-- Etapa 025: link público por sessão. Stream key continua em arquivo privado.
ALTER TABLE "Transmission" ADD COLUMN "publicUrl" TEXT;
ALTER TABLE "Transmission" ADD COLUMN "publicDestinationId" TEXT;
ALTER TABLE "Transmission" ADD COLUMN "publicPublishedAt" DATETIME;
