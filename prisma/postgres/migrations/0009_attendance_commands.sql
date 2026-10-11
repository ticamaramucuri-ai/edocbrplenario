ALTER TABLE "AttendanceEvent" ADD COLUMN "commandId" TEXT;
CREATE UNIQUE INDEX "AttendanceEvent_sessionId_commandId_key" ON "AttendanceEvent"("sessionId", "commandId");
