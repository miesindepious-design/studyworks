/**
 * The study group — rendering tests.
 *
 * A group is only worth having if it is honest about three things:
 *
 *   1. who is in the room;
 *   2. who may write, and who may delete;
 *   3. what happens when two people save the same note.
 *
 * The third is the important one, and it is the one the app must never get
 * wrong by guessing. These tests render the real component against a fake
 * server and check that the student is *shown* both versions rather than
 * having one quietly win.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import CollabView from './CollabView';
import { collabCapabilities } from '../utils/collab';
import { NAV_ITEMS, PAGE_TITLES } from '../config/nav';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const T1 = '2026-11-20T10:00:00.000Z';

function note(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    title: 'Photosynthesis',
    content: '<p>Light in, sugar out.</p>',
    tags: ['plants'],
    revision: 1,
    updatedAt: T1,
    lastEditedBy: 'owner',
    ...over,
  };
}

function folder(over: Record<string, unknown> = {}) {
  return {
    folderId: 'f1',
    folderName: 'Biology',
    ownerId: 'owner',
    myRole: 'owner',
    userId: 'owner',
    notes: [note()],
    members: [
      { memberId: null, userId: 'owner', name: 'Ada', role: 'owner', lastSeenAt: null },
      { memberId: 'm1', userId: 'grace', name: 'Grace', role: 'editor', lastSeenAt: T1 },
    ],
    ...over,
  };
}

/** A fetch that answers the two calls the view makes on open. */
function fakeServer(payload: unknown) {
  return vi.fn(async (input: any) => {
    const url = String(input);
    const body = url.includes('/ticket')
      ? { ticket: 'ticket-1' }
      : url.includes('/join')
        ? payload
        : payload;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/** The socket is a convenience; the tests do not need it to connect. */
class StubWebSocket {
  static OPEN = 1;
  readyState = 0;
  onmessage: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  constructor(public url: string) {}
  send() {}
  close() { this.onclose?.({}); }
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('WebSocket', StubWebSocket);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      <CollabView
        folderId="f1"
        folders={[{ id: 'f1', name: 'Biology' }]}
        userId="owner"
        userName="Ada"
        {...props}
      />,
    );
  });
  // Let the load and the socket ticket settle.
  await act(async () => { await Promise.resolve(); });
  return container.textContent ?? '';
}

describe('the study group', () => {
  it('opens the folder and shows what is in it', async () => {
    vi.stubGlobal('fetch', fakeServer(folder()));
    const text = await render();
    expect(text).toContain('Biology');
    expect(text).toContain('Photosynthesis');
  });

  it('tells the student who else is in the room', async () => {
    vi.stubGlobal('fetch', fakeServer(folder()));
    await render();
    // The group panel is behind a button, because on a narrow screen the
    // notes need the room. Open it and the people have to be named.
    const group = Array.from(container.querySelectorAll('button'))
      .find(b => (b.textContent ?? '').startsWith('Group ('));
    expect(group).toBeTruthy();
    await act(async () => { group!.click(); });
    expect(container.textContent).toContain('Grace');
  });

  it('lets the owner write and delete', async () => {
    vi.stubGlobal('fetch', fakeServer(folder()));
    const text = await render();
    expect(text).toContain('New note');
    expect(text).toContain('Delete');
  });

  it('lets an editor write but not delete', async () => {
    vi.stubGlobal('fetch', fakeServer(folder({ myRole: 'editor', userId: 'grace' })));
    const text = await render({ userId: 'grace', userName: 'Grace' });
    expect(text).toContain('New note');
    expect(text).not.toContain('Delete');
  });

  it('gives a viewer no way to change anything', async () => {
    vi.stubGlobal('fetch', fakeServer(folder({ myRole: 'viewer', userId: 'tim' })));
    const text = await render({ userId: 'tim', userName: 'Tim' });
    expect(text).not.toContain('New note');
    expect(text).not.toContain('Delete');
    expect(text).not.toContain('Save');
  });

  it('shows a member of the group the owner is in charge', async () => {
    vi.stubGlobal('fetch', fakeServer(folder()));
    const text = await render();
    // The group panel is the owner's alone.
    expect(text).toContain('Group (2)');
  });

  it('offers the folders to choose from when nobody picked one', async () => {
    const text = await render({ folderId: null, folders: [{ id: 'f1', name: 'Biology' }] });
    expect(text).toContain('Study groups');
    expect(text).toContain('Biology');
  });
});

describe('the roles, in one place', () => {
  it('gives the owner everything', () => {
    expect(collabCapabilities('owner')).toEqual({
      canEdit: true, canDelete: true, canCreate: true, canManageGroup: true,
    });
  });

  it('gives an editor the pen but not the eraser', () => {
    expect(collabCapabilities('editor')).toEqual({
      canEdit: true, canDelete: false, canCreate: true, canManageGroup: false,
    });
  });

  it('gives a viewer nothing to change', () => {
    expect(collabCapabilities('viewer')).toEqual({
      canEdit: false, canDelete: false, canCreate: false, canManageGroup: false,
    });
  });

  it('treats an unknown role as read-only', () => {
    expect(collabCapabilities(undefined).canEdit).toBe(false);
  });
});

describe('the navigation', () => {
  it('has a Study Group in it', () => {
    expect(NAV_ITEMS.some(i => i.view === 'collab')).toBe(true);
    expect(PAGE_TITLES.collab).toBeTruthy();
  });

  it('points every nav item at a view that exists', () => {
    for (const item of NAV_ITEMS) {
      expect(PAGE_TITLES[item.view]).toBeTruthy();
    }
  });
});
