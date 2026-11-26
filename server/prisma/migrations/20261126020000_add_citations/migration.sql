-- Sources for the bibliography generator. Only the facts are stored; the
-- APA/MLA/Harvard/Chicago formatting happens on the client.
CREATE TABLE "Citation" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "type"      TEXT NOT NULL DEFAULT 'book',
    "authors"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "editor"    TEXT,
    "year"      TEXT NOT NULL DEFAULT '',
    "title"     TEXT NOT NULL,
    "container" TEXT,
    "publisher" TEXT,
    "place"     TEXT,
    "volume"    TEXT,
    "issue"     TEXT,
    "pages"     TEXT,
    "url"       TEXT,
    "doi"       TEXT,
    "accessed"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Citation_userId_idx" ON "Citation"("userId");

ALTER TABLE "Citation" ADD CONSTRAINT "Citation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
