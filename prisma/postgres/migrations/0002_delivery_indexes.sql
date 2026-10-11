-- PostgreSQL-only partial indexes for the polling queues.
-- Run outside a transaction because CONCURRENTLY is required on populated databases.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OutboxEvent_pending_createdAt_id_idx"
  ON "OutboxEvent" ("createdAt", "id") WHERE status = 'pending';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "WebhookDelivery_pending_due_idx"
  ON "WebhookDelivery" ("nextAttemptAt", "createdAt", "id") WHERE status = 'pending';
