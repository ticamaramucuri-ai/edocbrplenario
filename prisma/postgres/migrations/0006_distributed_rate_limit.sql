CREATE TABLE "RateLimitHit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "keyHash" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RateLimitHit_keyHash_at_idx" ON "RateLimitHit"("keyHash", "at");
CREATE INDEX "RateLimitHit_at_idx" ON "RateLimitHit"("at");
