-- Phase 4: Lobby presence — who is actually in a lobby right now.
--
-- Study sessions need server-side presence to answer three questions the
-- client can't answer on its own: who is here, who is the host, and has
-- everybody left. A participant heartbeats by polling the lobby state;
-- when the host leaves (or goes silent) the earliest-joined active
-- participant becomes the host, and a lobby that has been empty for two
-- minutes is closed by the sweep.
CREATE TABLE IF NOT EXISTS "LobbyParticipant" (
    "id"         TEXT NOT NULL,
    "lobbyId"    TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "joinedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt"     TIMESTAMP(3),

    CONSTRAINT "LobbyParticipant_pkey" PRIMARY KEY ("id")
);

-- One row per player per lobby: rejoining flips leftAt back to null rather
-- than adding a second row.
CREATE UNIQUE INDEX IF NOT EXISTS "LobbyParticipant_lobbyId_userId_key" ON "LobbyParticipant"("lobbyId", "userId");
CREATE INDEX IF NOT EXISTS "LobbyParticipant_lobbyId_idx" ON "LobbyParticipant"("lobbyId");
CREATE INDEX IF NOT EXISTS "LobbyParticipant_userId_idx" ON "LobbyParticipant"("userId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'LobbyParticipant_lobbyId_fkey'
    ) THEN
        ALTER TABLE "LobbyParticipant" ADD CONSTRAINT "LobbyParticipant_lobbyId_fkey"
            FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'LobbyParticipant_userId_fkey'
    ) THEN
        ALTER TABLE "LobbyParticipant" ADD CONSTRAINT "LobbyParticipant_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
