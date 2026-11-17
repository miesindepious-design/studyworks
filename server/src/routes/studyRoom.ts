import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { createLobbyForSession } from '../lib/lobby.js';

const CreateBody = z.object({
  // Name is optional: the frontend sends `undefined` when the input is empty,
  // and the handler falls back to a default. A required name here makes an
  // empty form field fail validation with an opaque Zod error object.
  name: z.string().min(1).max(64).optional(),
  maxParticipants: z.number().int().min(2).max(12).default(6),
});

// If Daily.co is configured, create a real room. Otherwise we still return a
// namespaced room id so the frontend can present a stable "Study Room" UI and
// the feature is ready to activate by setting DAILY_API_KEY.
async function createDailyRoom(name: string, maxParticipants: number): Promise<{ url: string; id: string } | null> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name,
      properties: {
        max_participants: maxParticipants,
        enable_chat: true,
        enable_screenshare: true,
        start_video_off: false,
        start_audio_off: false,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Daily room creation failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { id: string; url: string };
  return { id: data.id, url: data.url };
}

export const studyRoomRouter = new Hono();
studyRoomRouter.use('/*', requireAuth);

studyRoomRouter.post('/', zValidator('json', CreateBody), async c => {
  const user = c.get('user');
  const { name, maxParticipants } = await c.req.valid('json');

  const roomName = `studyworks-${user.id}-${Date.now().toString(36)}`;
  const daily = await createDailyRoom(roomName, maxParticipants);

  // The room id doubles as the voice-room key (`voice-<id>`) that the client
  // hands to the signaling server, so a joiner who arrives through a lobby
  // lands in the same voice room as the host.
  const roomId = daily?.id ?? roomName;

  // Every room gets a lobby: the six-digit code, share link and QR code that
  // let a friend land straight in this session. A failure here must not
  // block the room from being created.
  let lobbyCode: string | null = null;
  try {
    const lobby = await createLobbyForSession({
      hostId: user.id,
      kind: 'study',
      title: name || 'Study room',
      targetCode: roomId,
      targetUrl: daily?.url ?? null,
      maxParticipants,
    });
    lobbyCode = lobby.code;
  } catch (err) {
    console.error('[studyRoom] failed to create lobby for room', roomName, err);
  }

  return c.json({
    id: roomId,
    name: name || `Study room`,
    url: daily?.url ?? null,
    roomName,
    provider: daily ? 'daily' : 'local',
    maxParticipants,
    lobbyCode,
    createdAt: new Date().toISOString(),
  }, 201);
});

studyRoomRouter.get('/', async c => {
  const user = c.get('user');
  // In a real app you'd persist rooms. For v1 we return a fresh room ID
  // or a previously stored one. Keep it simple: the client owns the current
  // room URL for this session.
  return c.json({ ok: true, note: 'Use POST /api/study-room to create a room.' });
});
