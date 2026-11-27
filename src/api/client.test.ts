/**
 * Tests for the base API client's error handling.
 *
 * Every request in the app goes through `apiFetch`, so a change to how it
 * reads an error response is a change to every error message in the app.
 * These pin down each shape the server sends, and that the body itself is
 * kept — a collaborative save that is refused returns the note as it is now,
 * and that is the part the person needs to see.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { APIError, apiFetch } from './client';
import { CollabConflictError, saveCollabNote } from './collab';
import type { CollabNote } from '../utils/collab';

function respond(status: number, payload: unknown, statusText = '') {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Response(text, {
    status,
    statusText,
    headers: { 'Content-Type': payload instanceof Object ? 'application/json' : 'text/plain' },
  });
}

afterEach(() => vi.unstubAllGlobals());

async function errorFrom(status: number, payload: unknown, statusText = ''): Promise<APIError> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(status, payload, statusText)));
  try {
    await apiFetch('/x');
  } catch (err) {
    expect(err).toBeInstanceOf(APIError);
    return err as APIError;
  }
  throw new Error('the request should have failed');
}

describe('apiFetch — the message', () => {
  it('uses the error string when there is one', async () => {
    const err = await errorFrom(403, { error: 'This link is read-only.' }, 'Forbidden');
    expect(err.message).toBe('This link is read-only.');
    expect(err.status).toBe(403);
  });

  it('falls back to the status text when the body says nothing', async () => {
    const err = await errorFrom(500, {}, 'Internal Server Error');
    expect(err.message).toBe('Internal Server Error');
  });

  it('falls back to the status text when the body is not JSON', async () => {
    const err = await errorFrom(502, '<html>Bad gateway</html>', 'Bad Gateway');
    expect(err.message).toBe('Bad Gateway');
    expect(err.body).toBeUndefined();
  });

  it('lists the issues of a validation error instead of "[object Object]"', async () => {
    const err = await errorFrom(400, {
      error: { issues: [{ message: 'Required' }, { message: 'Too big' }] },
    });
    expect(err.message).toBe('Required; Too big');
  });

  it('uses the nested message of an error object', async () => {
    const err = await errorFrom(500, { error: { message: 'db gone' } });
    expect(err.message).toBe('db gone');
  });

  it('does not turn a string that is not JSON into a crash', async () => {
    const err = await errorFrom(418, 'not json', "I'm a teapot");
    expect(err.message).toBe("I'm a teapot");
  });
});

describe('apiFetch — the body', () => {
  it('keeps the body of an error response', async () => {
    const err = await errorFrom(403, { error: 'Free plan limit', currentCount: 120, limit: 100 });
    expect(err.body).toEqual({ error: 'Free plan limit', currentCount: 120, limit: 100 });
  });

  it('has no body when the response was not JSON', async () => {
    const err = await errorFrom(502, 'oops', 'Bad Gateway');
    expect(err.body).toBeUndefined();
  });

  it('returns a successful body untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, { ok: true, n: 3 })));
    await expect(apiFetch<{ ok: boolean; n: number }>('/x')).resolves.toEqual({ ok: true, n: 3 });
  });

  it('sends the session cookie with every request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/x');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });
});

describe('saveCollabNote — a refused save', () => {
  const base: CollabNote = {
    id: 'n1', title: 'T', content: '<p>a</p>', tags: [], revision: 1,
    updatedAt: '2026-11-20T10:00:00.000Z', lastEditedBy: null,
  };
  const draft = { noteId: 'n1', title: 'T', content: '<p>b</p>', tags: [], base };

  it('becomes a CollabConflictError carrying the note as it is now', async () => {
    const theirs: CollabNote = { ...base, content: '<p>theirs</p>', revision: 2 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      respond(409, { error: 'Someone else saved this note first.', current: theirs }),
    ));

    const err = await saveCollabNote('f1', draft).catch(e => e);
    expect(err).toBeInstanceOf(CollabConflictError);
    expect((err as CollabConflictError).message).toBe('Someone else saved this note first.');
    expect((err as CollabConflictError).current.content).toBe('<p>theirs</p>');
  });

  it('is still an error, just an ordinary one, when there is no note to show', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      respond(409, { error: 'Something odd happened.' }),
    ));
    const err = await saveCollabNote('f1', draft).catch(e => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err).not.toBeInstanceOf(CollabConflictError);
    expect((err as APIError).status).toBe(409);
  });

  it('sends the version the draft started from', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respond(200, { ...base, content: '<p>b</p>', revision: 2 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const saved = await saveCollabNote('f1', draft, 'cc_7');
    expect(saved.revision).toBe(2);

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/collab/f1/notes/n1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'T', content: '<p>b</p>', tags: [],
      baseUpdatedAt: '2026-11-20T10:00:00.000Z', baseRevision: 1, connId: 'cc_7',
    });
  });
});
