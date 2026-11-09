-- Guarda o manifesto canônico emitido para ler um artefato sem carregar o pacote inteiro.
-- Emissões antigas permanecem nulas e usam o caminho de compatibilidade.
ALTER TABLE "LocalSessionTransferIssue" ADD COLUMN "manifestJson" TEXT;
