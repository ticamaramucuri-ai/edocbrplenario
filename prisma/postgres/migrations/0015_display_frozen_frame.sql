ALTER TABLE "DisplayState" ADD COLUMN "frozenFrameJson" TEXT;
ALTER TABLE "DisplayState" ADD COLUMN "frozenFrameSha256" TEXT;
ALTER TABLE "DisplayState" ADD COLUMN "frozenAt" TIMESTAMP(3);
