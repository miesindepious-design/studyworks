/**
 * collabAccess — who may do what in a shared folder.
 *
 * Both the REST route and the live socket need this, and they must agree: a
 * socket is opened with a ticket that was issued after a check, but it then
 * stays open for hours while the owner removes people and revokes links. So
 * the socket checks again on open, and the rule lives here rather than in
 * either caller.
 *
 * The rules:
 *
 *   - The owner can do anything. The owner is never a "member".
 *   - An editor can add notes and change any note, but not delete one.
 *   - A viewer can read.
 *   - A link that has expired or been revoked grants nothing, even to
 *     somebody who joined while it was valid.
 *   - A folder can have several links, so the most permissive live
 *     membership wins.
 */
import { prisma } from './prisma.js';

export type CollabRole = 'owner' | 'editor' | 'viewer';

export interface ResolvedAccess {
  folderId: string;
  folderName: string;
  ownerId: string;
  role: CollabRole;
}

export function canEdit(role: CollabRole): boolean {
  return role === 'owner' || role === 'editor';
}

export async function resolveAccess(folderId: string, userId: string): Promise<ResolvedAccess | null> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true, userId: true, name: true },
  });
  if (!folder) return null;
  if (folder.userId === userId) {
    return { folderId: folder.id, folderName: folder.name, ownerId: folder.userId, role: 'owner' };
  }

  const memberships = await prisma.shareMember.findMany({
    where: {
      userId,
      share: {
        folderId,
        revoked: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    },
    select: { role: true },
  });
  if (memberships.length === 0) return null;

  const role: CollabRole = memberships.some(m => m.role === 'editor') ? 'editor' : 'viewer';
  return { folderId: folder.id, folderName: folder.name, ownerId: folder.userId, role };
}

/**
 * Close the live sockets of anybody who no longer has access to a folder.
 *
 * Called after the owner changes the group. The writes these people could
 * make are already refused by `resolveAccess` on every request; this is about
 * the socket, which would otherwise keep telling them who is in the folder.
 *
 * This never throws. By the time it runs the removal is already committed,
 * and reporting a committed change as failed would send the owner back to
 * retry something that worked. A socket left open by a failed lookup closes
 * on its own at the next request, which refuses it.
 */
export async function closeLostAccess(
  folderId: string,
  userIds: string[],
  closeUser: (folderId: string, userId: string, reason: string) => void,
): Promise<void> {
  for (const userId of userIds) {
    try {
      const still = await resolveAccess(folderId, userId);
      if (!still) closeUser(folderId, userId, 'You no longer have access to this folder.');
    } catch (err) {
      console.warn('[collab] could not check access after a change; leaving the socket to close on its own:', err);
    }
  }
}
