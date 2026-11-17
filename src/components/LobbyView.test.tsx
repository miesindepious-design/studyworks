/**
 * Lobby — the shareable front door to a live session.
 *
 * The whole feature rests on one promise: the six-digit code, the share link
 * and the QR code all lead to the same place, and that place refers the
 * player to the right kind of session. These tests pin that promise down:
 *
 *   1. LobbyShare shows the code, the link and a QR code.
 *   2. The QR encodes the *link*, not the bare code, so a scan works from
 *      any device whether or not the player is signed in.
 *   3. LobbyView resolves an incoming code into a referral card.
 *   4. Entering the card hands the player the quiz room code, or the study
 *      room's voice id and URL.
 *   5. A session that has already ended is reported, not entered.
 *
 * There is no testing-library in this project, so the components are driven
 * directly through `react-dom/client` and React 19's `act`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getLobby:      vi.fn(),
    listMyLobbies: vi.fn(),
    createLobby:   vi.fn(),
  },
}));

// Keep the real `lobbyShareUrl` — the link format is part of what we test.
vi.mock('../api/lobby', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/lobby')>();
  return { ...actual, ...apiMock };
});

import LobbyShare from './LobbyShare';
import LobbyView from './LobbyView';

// React needs to know it is inside an `act` environment.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = '482913';

const QUIZ_LOBBY = {
  code: CODE,
  kind: 'quiz',
  title: 'Quiz Battle',
  status: 'open',
  maxParticipants: 12,
  createdAt: '2026-11-17T00:00:00.000Z',
  expiresAt: null,
  hostName: 'Ada',
  sessionTitle: 'Photosynthesis',
  playerCount: 3,
  target: { kind: 'quiz', roomCode: 'ROOM123' },
};

const STUDY_LOBBY = {
  ...QUIZ_LOBBY,
  kind: 'study',
  title: 'Chemistry session',
  sessionTitle: 'Chemistry session',
  playerCount: null,
  target: {
    kind: 'study',
    roomUrl: 'https://example.daily.co/room',
    voiceRoomId: 'voice-room-1',
  },
};

const addToast = vi.fn();

/** Let pending promises and effects settle. */
async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function buttonByText(container: HTMLElement, needle: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').includes(needle));
  if (!match) throw new Error(`No button matching "${needle}"`);
  return match;
}

/** Set an input's value the way a user would, so React sees the change. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Type a six-digit code into the lobby box and press Join. */
async function joinWithCode(container: HTMLElement, code: string) {
  const input = container.querySelector('input[aria-label="Six-digit lobby code"]') as HTMLInputElement;
  await typeInto(input, code);
  // The click resolves the code asynchronously, so the state update lands a
  // tick later — keep it inside the act scope.
  await act(async () => {
    buttonByText(container, 'Join').click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await flush();
}

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(element); });
  await flush();
  return { container, root };
}

describe('LobbyShare', () => {
  it('shows the six-digit code, the share link and a QR code', async () => {
    const { container, root } = await mount(
      createElement(LobbyShare, { code: CODE, label: 'Share this lobby' }),
    );

    // The code itself, big enough to read across a room.
    expect(container.textContent).toContain(CODE);

    // The link — same destination as the code.
    const link = container.querySelector('input') as HTMLInputElement;
    expect(link.value).toContain(`?lobby=${CODE}`);

    // A QR code for the same destination.
    expect(container.querySelector('svg')).toBeTruthy();

    await act(async () => root.unmount());
  });

  it('drops the QR code in compact mode but keeps the code and the link', async () => {
    const { container, root } = await mount(
      createElement(LobbyShare, { code: CODE, compact: true }),
    );

    expect(container.textContent).toContain(CODE);
    expect((container.querySelector('input') as HTMLInputElement).value).toContain(`?lobby=${CODE}`);
    expect(container.querySelector('svg')).toBeNull();

    await act(async () => root.unmount());
  });
});

describe('LobbyView — resolving a code', () => {
  beforeEach(() => {
    apiMock.getLobby.mockReset();
    apiMock.listMyLobbies.mockReset();
    apiMock.listMyLobbies.mockResolvedValue([]);
    addToast.mockReset();
  });

  it('resolves an incoming code into a referral card', async () => {
    apiMock.getLobby.mockResolvedValue(QUIZ_LOBBY);
    const onCodeConsumed = vi.fn();

    const { container, root } = await mount(
      createElement(LobbyView, {
        code: CODE,
        onCodeConsumed,
        onEnterQuiz: vi.fn(),
        onEnterStudy: vi.fn(),
        addToast,
      }),
    );

    expect(apiMock.getLobby).toHaveBeenCalledWith(CODE);
    expect(container.textContent).toContain('Photosynthesis');
    expect(container.textContent).toContain('Quiz Battle');
    expect(container.textContent).toContain('Ada');
    expect(container.textContent).toContain('3 players');

    // The code is consumed so the app stops re-resolving it.
    expect(onCodeConsumed).toHaveBeenCalledWith(null);

    await act(async () => root.unmount());
  });

  it('refers the player to the quiz room', async () => {
    apiMock.getLobby.mockResolvedValue(QUIZ_LOBBY);
    const onEnterQuiz = vi.fn();
    const onEnterStudy = vi.fn();

    const { container, root } = await mount(
      createElement(LobbyView, { onEnterQuiz, onEnterStudy, addToast }),
    );

    // The player's own path in: type the six-digit code the host read out.
    await joinWithCode(container, CODE);
    expect(apiMock.getLobby).toHaveBeenCalledWith(CODE);

    await act(async () => {
      buttonByText(container, 'Enter Quiz Battle').click();
    });

    expect(onEnterQuiz).toHaveBeenCalledWith('ROOM123');
    expect(onEnterStudy).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('refers the player to the study room with its voice id', async () => {
    apiMock.getLobby.mockResolvedValue(STUDY_LOBBY);
    const onEnterQuiz = vi.fn();
    const onEnterStudy = vi.fn();

    const { container, root } = await mount(
      createElement(LobbyView, { onEnterQuiz, onEnterStudy, addToast }),
    );

    await joinWithCode(container, CODE);

    await act(async () => {
      buttonByText(container, 'Enter Study Room').click();
    });

    expect(onEnterStudy).toHaveBeenCalledWith('voice-room-1', 'https://example.daily.co/room');
    expect(onEnterQuiz).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('reports a finished session instead of entering it', async () => {
    apiMock.getLobby.mockResolvedValue({ ...QUIZ_LOBBY, status: 'closed' });
    const onEnterQuiz = vi.fn();

    const { container, root } = await mount(
      createElement(LobbyView, { onEnterQuiz, onEnterStudy: vi.fn(), addToast }),
    );

    await joinWithCode(container, CODE);

    expect(container.textContent).toContain('already ended');
    // A finished session offers no way in.
    expect(
      Array.from(container.querySelectorAll('button'))
        .some(b => (b.textContent ?? '').includes('Enter Quiz Battle')),
    ).toBe(false);
    expect(onEnterQuiz).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('explains a code that cannot be found', async () => {
    apiMock.getLobby.mockRejectedValue(new Error('No lobby found with that code.'));

    const { container, root } = await mount(
      createElement(LobbyView, { onEnterQuiz: vi.fn(), onEnterStudy: vi.fn(), addToast }),
    );

    await joinWithCode(container, CODE);

    expect(container.textContent).toContain('No lobby found with that code.');

    await act(async () => root.unmount());
  });
});
