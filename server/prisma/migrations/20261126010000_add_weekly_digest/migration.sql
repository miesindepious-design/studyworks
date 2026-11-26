-- Weekly email digest: the student opts in, and says which day it lands.
--
-- Off by default. Nobody receives mail they did not ask for.
--
-- `digestLastSentAt` is what makes a retried weekly run safe: without it a
-- second run on the same day would send the digest twice.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "digestDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "digestLastSentAt" TIMESTAMP(3);
