-- Emissões sem confirmação expiram após 30 dias; ACKs permanecem como prova.
CREATE INDEX "LocalSessionTransferIssue_acknowledgedAt_issuedAt_idx"
  ON "LocalSessionTransferIssue"("acknowledgedAt", "issuedAt");
