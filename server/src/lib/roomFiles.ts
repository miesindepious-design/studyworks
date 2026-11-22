/**
 * roomFiles.ts — moving shared material between lobbies.
 *
 * A group shares its material in one lobby. When they turn that material
 * into a live quiz battle, the battle gets its own lobby (the room's front
 * door, with its own code and QR) — so the files are copied across, and the
 * material travels with the game.
 */

import { prisma } from './prisma.js';

/**
 * Copy the shared files from one lobby into another. Returns how many were
 * copied. Best effort: a failure here must not lose the game.
 */
export async function copyLobbyFiles(params: {
  fromLobbyId: string;
  toLobbyId: string;
  fileIds?: string[];
  uploaderId: string;
}): Promise<number> {
  const where: Record<string, unknown> = { lobbyId: params.fromLobbyId };
  if (params.fileIds?.length) where.id = { in: params.fileIds };

  const files = await prisma.roomFile.findMany({ where });
  if (files.length === 0) return 0;

  await prisma.roomFile.createMany({
    data: files.map(f => ({
      lobbyId: params.toLobbyId,
      uploaderId: params.uploaderId,
      name: f.name,
      type: f.type,
      size: f.size,
      storageKey: f.storageKey,
      url: f.url,
      text: f.text,
    })),
  });

  return files.length;
}
