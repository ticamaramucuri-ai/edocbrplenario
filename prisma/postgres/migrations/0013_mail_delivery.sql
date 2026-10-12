CREATE TABLE "MailDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailDelivery_subscriptionId_tokenHash_key" ON "MailDelivery"("subscriptionId", "tokenHash");
CREATE INDEX "MailDelivery_status_nextAttemptAt_leaseUntil_createdAt_idx" ON "MailDelivery"("status", "nextAttemptAt", "leaseUntil", "createdAt");
CREATE INDEX "MailDelivery_tenantId_status_idx" ON "MailDelivery"("tenantId", "status");
ALTER TABLE "MailDelivery" ADD CONSTRAINT "MailDelivery_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "CitizenSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
