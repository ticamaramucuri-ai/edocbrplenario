-- Arquivo de matéria privado por Câmara, com integridade verificável.
-- Referências legadas por URL permanecem nulas e não são convertidas por suposição.
ALTER TABLE "MatterAttachment" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "MatterAttachment" ADD COLUMN "sha256" TEXT;
ALTER TABLE "MatterAttachment" ADD COLUMN "content" BYTEA;
