/**
 * The collaboration WebSocket: who is in a shared folder, and what changed.
 *
 *   GET /ws/collab?folder=<folderId>&ticket=<one-time ticket>
 *
 * The client asks REST for a ticket (`POST /api/collab/:folderId/ticket`),
 * then opens this socket. As with the quiz socket, the ticket is single-use
 * and short-lived, so the URL is not a credential worth replaying.
 *
 * What travels here is deliberately small. The notes themselves go through
 * REST, where every write is checked against the version it started from.
 * This socket carries only what REST cannot: presence — who is in the
 * folder, who has which note open — and a nudge that says "note X changed,
 * fetch it". It never carries note content.
 *
 *   client → server   editing { noteId | null }
 *   server → client   welcome { connId, userId, role, members }
 *                     presence { members: { userId, name, noteId? }[] }
 *                     joined | left { userId, name }
 *                     editing { userId, name, noteId }
 *                     note-updated | note-created | note-deleted { noteId, by }
 *                     group-changed { by }
 *                     kicked { message }
 *                     error { message }
 */
import type { Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { collabManager } from '../lib/collabManager.js';
import { resolveAccess } from '../lib/collabAccess.js';

/** Close codes the client can tell apart. */
const CLOSE_BAD_REQUEST = 4001;
const CLOSE_NO_ACCESS = 4003;

export function attachCollabWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    // Only claim our own path. The quiz server and the voice server each
    // listen for upgrades on this same HTTP server and ignore the rest.
    let url: URL;
    try {
      url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      return;
    }
    if (url.pathname !== '/ws/collab') return;

    wss.handleUpgrade(req, socket as any, head, ws => {
      wss.emit('connection', ws, req, url);
    });
  });

  wss.on('connection', async (ws: WebSocket, _req: unknown, url: URL) => {
    const folderId = url.searchParams.get('folder') ?? '';
    const ticket = url.searchParams.get('ticket') ?? '';

    const refuse = (message: string, code: number) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message }));
      ws.close(code, message);
    };

    if (!folderId || !ticket) {
      refuse('A folder and a ticket are required.', CLOSE_BAD_REQUEST);
      return;
    }

    // Spending the ticket first. It is only good once, so a refused socket
    // cannot be retried with the same ticket.
    const identity = collabManager.redeemTicket(folderId, ticket);
    if (!identity) {
      refuse('That link to the folder has expired. Reload the page.', CLOSE_BAD_REQUEST);
      return;
    }

    // The ticket was issued after an access check, but it is the socket that
    // matters: it stays open for hours, and the owner can remove someone or
    // revoke the link in that time. So access is confirmed again now, on the
    // same rule the REST route uses, before the person is let into the room.
    const access = await resolveAccess(folderId, identity.userId);
    if (!access) {
      refuse('You no longer have access to this folder.', CLOSE_NO_ACCESS);
      return;
    }

    const adapter = {
      send: (data: string) => { if (ws.readyState === 1) ws.send(data); },
      get readyState() { return ws.readyState; },
      close: () => ws.close(),
    };

    const conn = collabManager.join(folderId, identity, adapter);
    const connId = conn.connId;

    // The newcomer is told their own id first — it is how they leave
    // themselves out of "who is here" — then the room hears they arrived.
    collabManager.sendTo(connId, {
      type: 'welcome',
      connId,
      userId: identity.userId,
      role: access.role,
      members: collabManager.presence(folderId),
    });
    collabManager.broadcast(folderId, { type: 'joined', userId: identity.userId, name: identity.name }, connId);
    collabManager.broadcastPresence(folderId);

    ws.on('message', (raw: any) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'editing': {
          // `null` means they closed the note; anything else must be an id.
          const noteId = msg.noteId === null || msg.noteId === undefined
            ? null
            : String(msg.noteId).slice(0, 80);
          collabManager.setEditing(folderId, connId, noteId);
          break;
        }
        default:
          // Unknown frame types are ignored: a newer client may send things
          // this server does not know about yet.
          break;
      }
    });

    const leave = () => collabManager.disconnect(connId);
    ws.on('close', leave);
    ws.on('error', leave);
  });

  console.log('👥 Collaboration WebSocket attached at /ws/collab');
}
