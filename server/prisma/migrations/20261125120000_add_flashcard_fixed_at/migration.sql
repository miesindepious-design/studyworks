-- AI leech fixer: remember when a card's wording was rewritten.
--
-- A leech is usually a badly-worded card, so the fix is rewriting it, not
-- re-memorising it. This column records that the rewrite happened, which
-- stops the fixer from being offered (and the XP from being awarded) twice
-- for the same card.

-- AlterTable
ALTER TABLE "Flashcard" ADD COLUMN "fixedAt" TIMESTAMP(3);
