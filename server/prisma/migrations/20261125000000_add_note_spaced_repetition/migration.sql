-- Spaced repetition for notes.
--
-- Notes were schedulable by hand (nextReminder) but never came back on their
-- own, so the material a student actually wrote was the material they forgot
-- first. These columns put notes on the same SM-2 curve as flashcards and
-- practice questions.
--
-- The columns mirror the Flashcard table exactly, which is what lets one
-- scheduler drive all three types.

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "repetitions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "interval" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ef" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "nextReview" TIMESTAMP(3),
ADD COLUMN     "reviewHistory" JSONB,
ADD COLUMN     "leechCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Note_userId_nextReview_idx" ON "Note"("userId", "nextReview");
