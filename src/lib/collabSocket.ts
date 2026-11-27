/**
 * Typed client for the collaboration WebSocket.
 *
 * Usage:
 *   const socket = new CollabSocket();
 *   socket.connect(folderId, ticket, { onMessage, onClose });
 *   socket.setEditing(noteId);   // "I have this note open"
 *   socket.setEditing(null);     // "I closed it"
 *   socket.close();
 *
 * What arrives here is small on purpose — the notes go through REST, where
 * every save is checked. This socket only says who is around and which notes
 * changed; see routes/wsCollab.ts on the server for the full list.
 *
 * The socket is a convenience, not a requirement. If it cannot be opened —
 * a serverless deployment that cannot hold a socket, a flaky connection —
 * the folder still works: saves are still checked, and a reload shows what
 * changed. So a closed socket is reported and then left alone.
 */

import type { CollabRole, PresenceMember } from '../utils/collab';

export type CollabServerMessage =
  /** First frame: your own id, and who is already here. */
  | { type: 'welcome'; connId: string; userId: string; role: CollabRole; members: PresenceMember[] }
  | { type: 'presence'; members: PresenceMember[] }
  | { type: 'joined'; userId: string; name: string }
  | { type: 'left'; userId: string; name: string }
  | { type: 'editing'; userId: string; name: string; noteId: string | null }
  /** A note changed on the server. Fetch it; the content is not in here. */
  | { type: 'note-updated'; noteId: string; by: { userId: string; name: string } }
  | { type: 'note-created'; noteId: string; by: { userId: string; name: string } }
  | { type: 'note-deleted'; noteId: string; by: { userId: string; name: string } }
  | { type: 'group-changed'; by: { userId: string; name: string } }
  | { type: 'kicked'; message: string }
  | { type: 'error'; message: string };

export interface CollabSocketHandlers {
  onMessage: (msg: CollabServerMessage) => void;
  onClose?: (reason: 'kicked' | 'dropped') => void;
}

export class CollabSocket {
  private ws: WebSocket | null = null;
  /** Set when the server said why it is closing, so a kick is not mistaken for a drop. */
  private kicked = false;

  connect(folderId: string, ticket: string, handlers: CollabSocketHandlers) {
    this.close();

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // Same host as the page by default; the Vite dev server proxies the
    // socket to the API. The collaboration socket runs wherever the quiz
    // socket does, so it honours the same override for a platform that
    // cannot hold a socket.
    const configured = typeof import.meta.env.VITE_GAME_WS_URL === 'string'
      ? import.meta.env.VITE_GAME_WS_URL.trim()
      : '';
    const host = configured
      ? configured.replace(/^wss?:\/\//, '').replace(/\/+$/, '')
      : window.location.host;
    const url = `${proto}://${host}/ws/collab?folder=${encodeURIComponent(folderId)}&ticket=${encodeURIComponent(ticket)}`;

    const ws = new WebSocket(url);
    this.ws = ws;
    this.kicked = false;

    ws.onmessage = ev => {
      let msg: CollabServerMessage;
      try {
        msg = JSON.parse(ev.data) as CollabServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'kicked') this.kicked = true;
      handlers.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded by a newer connection
      this.ws = null;
      handlers.onClose?.(this.kicked ? 'kicked' : 'dropped');
    };
    // `onerror` is followed by `onclose`, which is where this is reported;
    // handling it here as well would say it twice.
    ws.onerror = () => {};
  }

  /** Say which note is open. `null` means none. */
  setEditing(noteId: string | null) {
    this.send({ type: 'editing', noteId });
  }

  private send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
