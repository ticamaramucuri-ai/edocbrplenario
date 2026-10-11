-- Claims temporários para múltiplas réplicas dos trabalhadores PostgreSQL.
ALTER TABLE "OutboxEvent" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN "leaseUntil" TIMESTAMP(3);
ALTER TABLE "WebhookDelivery" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN "leaseUntil" TIMESTAMP(3);
ALTER TABLE "ScheduledJob" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "ScheduledJob" ADD COLUMN "leaseUntil" TIMESTAMP(3);

CREATE INDEX "OutboxEvent_status_leaseUntil_createdAt_idx" ON "OutboxEvent"("status", "leaseUntil", "createdAt");
CREATE INDEX "WebhookDelivery_status_leaseUntil_nextAttemptAt_idx" ON "WebhookDelivery"("status", "leaseUntil", "nextAttemptAt");
CREATE INDEX "ScheduledJob_active_leaseUntil_nextRunAt_idx" ON "ScheduledJob"("active", "leaseUntil", "nextRunAt");
