-- Snapshot aditivo de matérias por revisão; revisões antigas permanecem NULL e
-- não são exportáveis para o servidor local sem nova publicação.
ALTER TABLE "SessionAgendaRevision" ADD COLUMN "matterManifestJson" TEXT;

CREATE TABLE "SessionMatterArtifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    CONSTRAINT "SessionMatterArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionMatterArtifact_revisionId_attachmentId_key" ON "SessionMatterArtifact"("revisionId", "attachmentId");
CREATE INDEX "SessionMatterArtifact_tenantId_revisionId_idx" ON "SessionMatterArtifact"("tenantId", "revisionId");
ALTER TABLE "SessionMatterArtifact" ADD CONSTRAINT "SessionMatterArtifact_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "SessionAgendaRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
