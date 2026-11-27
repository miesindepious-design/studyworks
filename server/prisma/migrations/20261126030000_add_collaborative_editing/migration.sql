-- Collaborative editing for shared folders.
--
-- A share link becomes a study group: the link carries a role (viewer or
-- editor), and the people who join through it are recorded so the group can
-- be seen and managed.
ALTER TABLE "FolderShare" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'viewer';

CREATE TABLE "ShareMember" (
    "id"         TEXT NOT NULL,
    "shareId"    TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "role"       TEXT NOT NULL DEFAULT 'viewer',
    "joinedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShareMember_shareId_userId_key" ON "ShareMember"("shareId", "userId");
CREATE INDEX "ShareMember_userId_idx" ON "ShareMember"("userId");

ALTER TABLE "ShareMember" ADD CONSTRAINT "ShareMember_shareId_fkey"
    FOREIGN KEY ("shareId") REFERENCES "FolderShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShareMember" ADD CONSTRAINT "ShareMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who changed a shared note, and how many times the group has. A
-- collaborative save only lands if the note is still as the editor loaded
-- it; `lastEditedBy` is who to blame, `collabRevision` is the count.
ALTER TABLE "Note" ADD COLUMN "collabRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Note" ADD COLUMN "lastEditedBy" TEXT;
