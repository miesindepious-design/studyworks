/**
 * collabManager — who is in the shared folder right now.
 *
 * A shared folder used to be a read-only view: one person published, everyone
 * else looked. The moment several people can edit the same note, they need
 * to know two things — who else is in the folder, and who is looking at the
 * note they are typing in. Otherwise two people silently overwrite each
 * other and neither knows why the text changed.
 *
 * So the manager keeps the presence in memory and the truth on disk:
 *
 *   - **presence** (who is connected, what they are editing) is in memory,
 *     because it is only meaningful while the socket is open. It disappears
 *     with the process, which is correct — nobody is in the folder when the
 *     server is down.
 *   - **the notes** are in the database, with a revision number on each one
 *     so a stale write can be refused.
 *
 * This mirrors `gameManager`: the transport (routes/wsCollab.ts) only
 * authenticates the socket and relays frames; the decisions live here.
 */
import { randomBytes } from 'node:crypto';

/** The transport-agnostic bit of a socket the manager needs. */
export interface WebSocketLike {
  send: (data: string) => void;
  readonly readyState: number;
  close: () => void;
}

/** One person, connected to one folder. */
export interface CollabConn {
  connId: string;
  userId: string;
  name: string;
  /** The note they currently have open, if any. */
  noteId?: string;
  /** The socket itself, so the room can reach them. */
  ws: WebSocketLike;
}

/** What the group list shows: who is here, and what they are looking at. */
export interface CollabPresence {
  userId: string;
  name: string;
  noteId?: string;
}

/** A ticket buys one socket opening, for one folder, for one minute. */
interface Ticket {
  folderId: string;
  userId: string;
  name: string;
  expires: number;
}

class CollabManager {
  /** folderId -> connId -> connection. */
  private rooms = new Map<string, Map<string, CollabConn>>();
  /** ticket -> what it entitles the holder to. */
  private tickets = new Map<string, Ticket>();
  /** connId -> folderId, so a close can find its room. */
  private connFolder = new Map<string, string>();
  private seq = 0;

  /**
   * Issue a short-lived ticket for opening the collaboration socket.
   *
   * The socket URL is not a credential worth replaying, so the client asks
   * REST for a ticket first and the ticket is spent on first use. It comes
   * from the CSPRNG: a ticket opens a socket as somebody, so it must not be
   * guessable the way `Math.random()` output is.
   */
  issueTicket(folderId: string, userId: string, name: string): string {
    // Sweep tickets nobody came back for, so the map does not grow with them.
    const now = Date.now();
    for (const [t, v] of this.tickets) if (v.expires < now) this.tickets.delete(t);

    const t = `ct_${randomBytes(18).toString('hex')}`;
    this.tickets.set(t, { folderId, userId, name, expires: now + 60_000 });
    return t;
  }

  /**
   * Spend a ticket and say whose it is, without joining a room yet.
   *
   * The caller still has to confirm the person may open this folder — a
   * ticket was true a moment ago and the owner may have changed the group
   * since — so the ticket is consumed here and the room joined after.
   */
  redeemTicket(folderId: string, ticket: string): { userId: string; name: string } | null {
    const v = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!v || v.expires < Date.now()) return null;
    if (v.folderId !== folderId) return null;
    return { userId: v.userId, name: v.name };
  }

  /** Put a confirmed person in the room. */
  join(folderId: string, identity: { userId: string; name: string }, ws: WebSocketLike): CollabConn {
    const connId = `cc_${++this.seq}`;
    const conn: CollabConn = { connId, userId: identity.userId, name: identity.name, ws };

    let room = this.rooms.get(folderId);
    if (!room) {
      room = new Map();
      this.rooms.set(folderId, room);
    }
    room.set(connId, conn);
    this.connFolder.set(connId, folderId);

    return conn;
  }

  /**
   * Close somebody's sockets in a folder and tell them why.
   *
   * Used when the owner takes their access away. The order matters: every
   * one of their sockets is taken out of the room first, and only then is
   * the room told. Done the other way round, a second tab still in the room
   * hears "Ada left" about itself before it hears why.
   */
  closeUser(folderId: string, userId: string, reason: string): void {
    const room = this.rooms.get(folderId);
    if (!room) return;

    const theirs: CollabConn[] = [];
    for (const [connId, conn] of room) {
      if (conn.userId === userId) theirs.push(conn);
    }
    if (theirs.length === 0) return;

    let name = reason;
    for (const conn of theirs) {
      name = conn.name;
      room.delete(conn.connId);
      this.connFolder.delete(conn.connId);
      try {
        if (conn.ws.readyState === 1) {
          // The reason goes first, so it arrives before the close event.
          conn.ws.send(JSON.stringify({ type: 'kicked', message: reason }));
          conn.ws.close();
        }
      } catch {
        /* already gone */
      }
    }

    if (room.size === 0) {
      this.rooms.delete(folderId);
      return;
    }
    this.broadcast(folderId, { type: 'left', userId, name });
    this.broadcastPresence(folderId);
  }

  /** The connection behind a frame, if it is still open. */
  getConn(folderId: string, connId: string): CollabConn | undefined {
    return this.rooms.get(folderId)?.get(connId);
  }

  /**
   * How many sockets are open into a folder. A folder with nobody in it
   * needs no broadcasting, and a test can use this to prove a disconnect
   * really removed the connection.
   */
  roomSize(folderId: string): number {
    return this.rooms.get(folderId)?.size ?? 0;
  }

  /** Close a socket and tell the room somebody left. */
  disconnect(connId: string): void {
    const folderId = this.connFolder.get(connId);
    if (!folderId) return;
    this.connFolder.delete(connId);

    const room = this.rooms.get(folderId);
    if (!room) return;
    const conn = room.get(connId);
    room.delete(connId);
    if (room.size === 0) {
      this.rooms.delete(folderId);
      return;
    }
    if (conn) {
      this.broadcast(folderId, {
        type: 'left',
        userId: conn.userId,
        name: conn.name,
      });
    }
    this.broadcastPresence(folderId);
  }

  /** Note which note somebody has open, or null when they close it. */
  setEditing(folderId: string, connId: string, noteId: string | null): void {
    const conn = this.getConn(folderId, connId);
    if (!conn) return;
    conn.noteId = noteId ?? undefined;
    // The editor already knows what they opened; everybody else is told.
    this.broadcast(folderId, {
      type: 'editing',
      userId: conn.userId,
      name: conn.name,
      noteId: conn.noteId ?? null,
    }, connId);
    this.broadcastPresence(folderId);
  }

  /** Everybody currently in the folder. */
  presence(folderId: string): CollabPresence[] {
    const room = this.rooms.get(folderId);
    if (!room) return [];
    return Array.from(room.values()).map(c => ({
      userId: c.userId,
      name: c.name,
      noteId: c.noteId,
    }));
  }

  /**
   * Send a frame to everybody in the folder, optionally except the sender.
   *
   * A socket that has closed is dropped from the room rather than retried:
   * its `close` event may already be on its way, and writing to it again
   * only raises.
   */
  broadcast(folderId: string, message: unknown, exceptConnId?: string): void {
    const room = this.rooms.get(folderId);
    if (!room) return;
    const data = JSON.stringify(message);
    for (const [id, conn] of room) {
      if (id === exceptConnId) continue;
      // 1 is WebSocket.OPEN on both `ws` and the browser.
      if (conn.ws.readyState !== 1) continue;
      try {
        conn.ws.send(data);
      } catch {
        /* a dead socket is not worth breaking the room for */
      }
    }
  }

  /** Send a frame to exactly one connection. */
  sendTo(connId: string, message: unknown): void {
    const folderId = this.connFolder.get(connId);
    const conn = folderId ? this.getConn(folderId, connId) : undefined;
    if (!conn || conn.ws.readyState !== 1) return;
    try {
      conn.ws.send(JSON.stringify(message));
    } catch {
      /* ignore */
    }
  }

  /** Send the current presence to everybody in the folder. */
  broadcastPresence(folderId: string): void {
    this.broadcast(folderId, { type: 'presence', members: this.presence(folderId) });
  }

  /** Test hook — drop every ticket and connection. */
  reset(): void {
    this.rooms.clear();
    this.tickets.clear();
    this.connFolder.clear();
    this.seq = 0;
  }
}

export const collabManager = new CollabManager();
