-- Removes only the additive indexes from migration 0002; no domain data is changed.
DROP INDEX CONCURRENTLY IF EXISTS "WebhookDelivery_pending_due_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OutboxEvent_pending_createdAt_id_idx";
