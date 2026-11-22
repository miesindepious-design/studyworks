-- AlterTable
ALTER TABLE "Lobby" ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: a lobby that existed before this column was created has been
-- active since the day it was made. Without this every old lobby would look
-- like it had just been touched, and none of them would ever close.
UPDATE "Lobby" SET "lastActivityAt" = "createdAt";
