/**
 * merge.ts — Last-Write-Wins (LWW) merge for cloud sync.
 *
 * Used in App.tsx after pullSync() to merge the server's view of a collection
 * with the client's local copy, instead of the old behaviour of
 * `setNotes(remote.notes)` which unconditionally clobbered local edits.
 *
 * Algorithm:
 *   - For each id, compare `updatedAt` timestamps (the server's schema has
 *     these on every collection).
 *   - The newer record wins. On a tie, the local copy wins (so the user
 *     doesn't lose unsynced offline edits just because the server echoed
 *     the same timestamp back).
 *   - Records present only on the server are kept.
 *   - Records present only locally are kept (offline edits that haven't
 *     been pushed yet).
 *
 * This is a per-record LWW — not a true CRDT. It's the same trade-off the
 * server's pushSync route already makes (LWW by updatedAt), so behaviour
 * is symmetric.
 */

type Timestamped = {
  id: string;
  updatedAt?: Date | null;
  createdAt?: Date | null;
};

function ts(d: Date | string | number | undefined | null): number {
  if (!d) return 0;
  const date = d instanceof Date ? d : new Date(d);
  const t = date.getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function mergeByLWW<T extends Timestamped>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>();
  // Local first — keeps `local` reference for ties.
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else {
      // Pick newer. Tie → keep local (avoid clobbering offline edits).
      const remoteT = ts(item.updatedAt ?? item.createdAt);
      const localT  = ts(existing.updatedAt ?? existing.createdAt);
      if (remoteT > localT) byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

/**
 * Merge a tier string. Server is authoritative for billing.
 * If the server says PRO but the client says free, trust the server (the
 * Stripe webhook already updated it).
 */
export function mergeTier(local: string | null | undefined, remote: string | null | undefined): string {
  return (remote || local || 'free').toLowerCase();
}
