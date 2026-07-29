/**
 * Typed client for the multiplayer quiz WebSocket.
 *
 * Usage:
 *   const client = new GameSocket();
 *   client.connect(code, ticket, { onMessage, onOpen, onClose });
 *   client.sendAnswer(questionId, choiceIdx);
 *   client.sendChat('hi');
 *   client.close();
 *
 * Events (ServerMessage types):
 *   question   { index, total, prompt, options, questionId, deadline }
 *   reveal     { answerIdx }
 *   scores     { scores: { userId, name, xp }[] }
 *   answer-ack { userId, correct, xp }
 *   player-joined { userId, name, role }
 *   player-left   { userId, name }
 *   chat       { userId, name, text }
 *   finished   { ranking: { userId, name, xp, rank }[], winnerId }
 *   room-ended { reason }
 *   error      { message }
 */

export type ServerMessage =
  | { type: 'question'; index: number; total: number; prompt: string; options: string[]; questionId: string; deadline: number }
  | { type: 'reveal'; answerIdx: number }
  | { type: 'scores'; scores: { userId: string; name: string; xp: number }[] }
  | { type: 'answer-ack'; userId: string; correct: boolean; xp: number }
  | { type: 'player-joined'; userId: string; name: string; role: 'host' | 'player' }
  | { type: 'player-left'; userId: string; name: string }
  | { type: 'chat'; userId: string; name: string; text: string }
  | { type: 'finished'; ranking: { userId: string; name: string; xp: number; rank: number }[]; winnerId: string | null }
  | { type: 'room-ended'; reason: string }
  | { type: 'error'; message: string };

export interface GameSocketHandlers {
  onMessage: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: (e: CloseEvent) => void;
  onError?: (e: Event) => void;
}

export class GameSocket {
  private ws: WebSocket | null = null;

  connect(roomCode: string, ticket: string, handlers: GameSocketHandlers) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host; // localhost:5173 in dev (Vite proxies ws to :3001)
    const url = `${proto}://${host}/ws?room=${encodeURIComponent(roomCode)}&ticket=${encodeURIComponent(ticket)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => handlers.onOpen?.();
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMessage;
        handlers.onMessage(msg);
      } catch { /* ignore malformed */ }
    };
    ws.onclose = (e) => handlers.onClose?.(e);
    ws.onerror = (e) => handlers.onError?.(e);
  }

  sendAnswer(questionId: string, choiceIdx: number) {
    this.send({ type: 'answer', questionId, choiceIdx });
  }

  sendChat(text: string) {
    this.send({ type: 'chat', text });
  }

  private send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
