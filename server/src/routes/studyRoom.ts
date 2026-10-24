import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';

const CreateBody = z.object({
  name: z.string().min(1).max(64),
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
  const { name, maxParticipants } = c.req.valid('json');

  const roomName = `studyworks-${user.id}-${Date.now().toString(36)}`;
  const daily = await createDailyRoom(roomName, maxParticipants);

  return c.json({
    id: daily?.id ?? roomName,
    name: name || `Study room`,
    url: daily?.url ?? null,
    roomName,
    provider: daily ? 'daily' : 'local',
    maxParticipants,
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
