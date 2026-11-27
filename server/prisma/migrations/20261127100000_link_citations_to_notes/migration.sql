-- Link a citation to the note it was used in.
--
-- A citation is often just a book on the student's shelf, so the link is
-- optional. But a student writing an essay needs to know which note said
-- what, and which source backs it — and that is only answerable if the
-- source remembers the note.
ALTER TABLE "Citation" ADD COLUMN "noteId" TEXT;

CREATE INDEX "Citation_userId_noteId_idx" ON "Citation"("userId", "noteId");

ALTER TABLE "Citation" ADD CONSTRAINT "Citation_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
