ALTER TABLE "Transmission" ADD COLUMN "publicObservationId" TEXT;

CREATE TABLE "MediaPublicObservation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "transmissionId" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "destinationGeneration" INTEGER NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "observerId" TEXT NOT NULL,
  "observerName" TEXT NOT NULL,
  "videoOk" BOOLEAN NOT NULL,
  "audioOk" BOOLEAN NOT NULL,
  "evidenceNote" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaPublicObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MediaPublicObservation_tenantId_sessionId_destinationId_observedAt_idx"
  ON "MediaPublicObservation"("tenantId", "sessionId", "destinationId", "observedAt");
ALTER TABLE "MediaPublicObservation" ADD CONSTRAINT "MediaPublicObservation_transmissionId_fkey"
  FOREIGN KEY ("transmissionId") REFERENCES "Transmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
