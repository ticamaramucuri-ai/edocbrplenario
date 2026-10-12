ALTER TABLE "Publication" ADD COLUMN "reviewHash" TEXT;
ALTER TABLE "Publication" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "Publication" ADD COLUMN "reviewedByName" TEXT;
ALTER TABLE "Publication" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Publication" ADD COLUMN "reviewReference" TEXT;
ALTER TABLE "Publication" ADD COLUMN "publishedContentSha256" TEXT;
ALTER TABLE "Publication" ADD COLUMN "activeAtaSessionKey" TEXT;
CREATE UNIQUE INDEX "Publication_activeAtaSessionKey_key" ON "Publication"("activeAtaSessionKey");
