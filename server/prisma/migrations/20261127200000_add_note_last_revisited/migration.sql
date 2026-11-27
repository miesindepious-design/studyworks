-- AddColumn: Note.lastRevisited
-- Tracks when the student last opened a note, so the Dashboard can count
-- "revisited this week" across devices.  The column is nullable because
-- older notes have never been opened on a device that writes this field,
-- and NULL is indistinguishable from "never opened".
ALTER TABLE "Note" ADD COLUMN "lastRevisited" TIMESTAMP(3);
