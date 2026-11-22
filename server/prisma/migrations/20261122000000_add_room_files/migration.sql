-- CreateTable
CREATE TABLE "RoomFile" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "size" INTEGER NOT NULL DEFAULT 0,
    "storageKey" TEXT,
    "url" TEXT,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomFile_lobbyId_idx" ON "RoomFile"("lobbyId");

-- CreateIndex
CREATE INDEX "RoomFile_uploaderId_idx" ON "RoomFile"("uploaderId");

-- AddForeignKey
ALTER TABLE "RoomFile" ADD CONSTRAINT "RoomFile_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomFile" ADD CONSTRAINT "RoomFile_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
