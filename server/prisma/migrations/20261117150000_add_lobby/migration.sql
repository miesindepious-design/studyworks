-- Phase 4: Lobby — the shareable front door to a live session.
--
-- Every quiz room and study room gets a Lobby row. The lobby owns the
-- six-digit code that people share and points at the real session, so a
-- player who arrives with only a code (or the share link, or the QR code)
-- can be routed to the right kind of session.
--
-- kind === 'quiz'  → targetCode is the GameRoom.code to join
-- kind === 'study' → targetCode is the voice room id, targetUrl the Daily URL
CREATE TABLE IF NOT EXISTS "Lobby" (
    "id"              TEXT NOT NULL,
    "code"            TEXT NOT NULL,
    "kind"            TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "hostId"          TEXT NOT NULL,
    "targetCode"      TEXT,
    "targetUrl"       TEXT,
    "maxParticipants" INTEGER NOT NULL DEFAULT 6,
    "status"          TEXT NOT NULL DEFAULT 'open',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"       TIMESTAMP(3),

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- The code is the public join handle: it must be unique, and lookups by code
-- happen on every lobby visit.
CREATE UNIQUE INDEX IF NOT EXISTS "Lobby_code_key" ON "Lobby"("code");
CREATE INDEX IF NOT EXISTS "Lobby_hostId_idx" ON "Lobby"("hostId");
CREATE INDEX IF NOT EXISTS "Lobby_kind_idx" ON "Lobby"("kind");

ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_hostId_fkey"
    FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
