/**
 * Admin dashboard — the account-deletion flow.
 *
 * Deleting an account is the most destructive thing an admin can do from the
 * dashboard, so the wiring matters as much as the server guards:
 *
 *   1. Clicking "Delete" loads the account's impact summary first, so the
 *      admin sees what is about to be lost before anything happens.
 *   2. The confirm button stays disabled until the admin types the account's
 *      exact email — a mis-click on the wrong row must not be enough.
 *   3. On success the row leaves the table and the tier counters drop by one.
 *   4. The admin's own row cannot be deleted from here at all.
 *
 * There is no testing-library in this project, so the component is driven
 * directly through `react-dom/client` and React 19's `act`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getAdminStats:   vi.fn(),
    getAdminUsers:   vi.fn(),
    setUserTier:     vi.fn(),
    getAdminUser:    vi.fn(),
    deleteAdminUser: vi.fn(),
  },
}));

vi.mock('../api/admin', () => apiMock);

import AdminDashboard from './AdminDashboard';

// React needs to know it is inside an `act` environment.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ADMIN = 'admin@example.com';

const USERS = [
  {
    id: 'u-admin', email: ADMIN, name: 'Admin', tier: 'PRO' as const,
    emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
    stripeSubscriptionId: null, stripeCurrentPeriodEnd: null, stripePriceId: null,
  },
  {
    id: 'u-target', email: 'student@example.com', name: 'Student', tier: 'PRO' as const,
    emailVerified: true, createdAt: '2026-02-01T00:00:00.000Z',
    stripeSubscriptionId: 'sub_123', stripeCurrentPeriodEnd: null, stripePriceId: 'price_1',
  },
];

const DETAIL = {
  user: USERS[1],
  counts: {
    notes: 12, folders: 3, contacts: 4, flashcards: 20, practiceQuestions: 7,
    savedSearches: 2, attachments: 5, gameRooms: 1, supportTickets: 3,
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

/** The table row that belongs to a given account. */
function rowFor(container: HTMLElement, email: string): HTMLElement {
  const row = Array.from(container.querySelectorAll('tbody tr'))
    .find(r => (r.textContent ?? '').includes(email));
  if (!row) throw new Error(`No row for ${email}`);
  return row as HTMLElement;
}

/** The Delete button inside a given account's row. */
function deleteButtonFor(container: HTMLElement, email: string): HTMLButtonElement {
  const btn = Array.from(rowFor(container, email).querySelectorAll('button'))
    .find(b => (b.textContent ?? '').includes('Delete'));
  if (!btn) throw new Error(`No delete button for ${email}`);
  return btn as HTMLButtonElement;
}

/** Set an input's value the way a user would, so React sees the change. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(createElement(AdminDashboard, { adminEmail: ADMIN, addToast }));
  });
  await flush();
  return { container, root };
}

describe('Admin dashboard — delete account', () => {
  beforeEach(() => {
    apiMock.getAdminStats.mockResolvedValue({ total: 2, pro: 2, free: 0 });
    apiMock.getAdminUsers.mockResolvedValue({ users: USERS });
    apiMock.getAdminUser.mockResolvedValue(DETAIL);
    apiMock.deleteAdminUser.mockResolvedValue({
      deleted: { id: 'u-target', email: 'student@example.com' },
      filesRemoved: 5,
      warnings: [],
    });
  });

  it('offers a delete action on every row but the admin’s own', async () => {
    const { container, root } = await mount();

    const deleteButtons = Array.from(container.querySelectorAll('tbody button'))
      .filter(b => (b.textContent ?? '').includes('Delete'));
    expect(deleteButtons.length).toBe(2);

    // The admin's own row is locked — the server refuses it too, but there
    // is no point offering a button that can only ever fail.
    expect(deleteButtonFor(container, ADMIN).disabled).toBe(true);
    expect(deleteButtonFor(container, 'student@example.com').disabled).toBe(false);

    await act(async () => root.unmount());
  });

  it('loads the impact summary before opening the dialog', async () => {
    const { container, root } = await mount();

    await act(async () => { deleteButtonFor(container, 'student@example.com').click(); });
    await flush();

    expect(apiMock.getAdminUser).toHaveBeenCalledWith('u-target');
    // The dialog lists what goes with the account.
    expect(container.textContent).toContain('Total items');
    expect(container.textContent).toContain('Notes');
    expect(container.textContent).toContain('Uploaded files');

    await act(async () => root.unmount());
  });

  it('keeps the confirm button disabled until the exact email is typed', async () => {
    const { container, root } = await mount();
    await act(async () => { deleteButtonFor(container, 'student@example.com').click(); });
    await flush();

    const confirm = buttonByText(container, 'Delete account');
    expect(confirm.disabled).toBe(true);

    // A near-miss is not enough.
    const input = container.querySelector('#admin-delete-confirm') as HTMLInputElement;
    await typeInto(input, 'student@example.co');
    expect(buttonByText(container, 'Delete account').disabled).toBe(true);

    await typeInto(input, 'student@example.com');
    expect(buttonByText(container, 'Delete account').disabled).toBe(false);

    await act(async () => root.unmount());
  });

  it('warns about an active subscription before deleting', async () => {
    const { container, root } = await mount();
    await act(async () => { deleteButtonFor(container, 'student@example.com').click(); });
    await flush();

    expect(container.textContent).toMatch(/active Stripe subscription/i);

    await act(async () => root.unmount());
  });

  it('deletes the account and drops the row and the counters', async () => {
    const { container, root } = await mount();
    await act(async () => { deleteButtonFor(container, 'student@example.com').click(); });
    await flush();

    const input = container.querySelector('#admin-delete-confirm') as HTMLInputElement;
    await typeInto(input, 'student@example.com');
    await act(async () => { buttonByText(container, 'Delete account').click(); });
    await flush();

    expect(apiMock.deleteAdminUser).toHaveBeenCalledWith('u-target', 'student@example.com');
    expect(addToast).toHaveBeenCalledWith('Deleted student@example.com', 'success');

    // The row is gone and the dialog closed.
    expect(container.textContent).not.toContain('student@example.com');
    expect(container.querySelector('#admin-delete-confirm')).toBeNull();

    await act(async () => root.unmount());
  });

  it('surfaces any warning the server returned', async () => {
    apiMock.deleteAdminUser.mockResolvedValue({
      deleted: { id: 'u-target', email: 'student@example.com' },
      filesRemoved: 0,
      warnings: ['Could not cancel the Stripe subscription. Cancel it manually in Stripe.'],
    });

    const { container, root } = await mount();
    await act(async () => { deleteButtonFor(container, 'student@example.com').click(); });
    await flush();
    const input = container.querySelector('#admin-delete-confirm') as HTMLInputElement;
    await typeInto(input, 'student@example.com');
    await act(async () => { buttonByText(container, 'Delete account').click(); });
    await flush();

    expect(addToast).toHaveBeenCalledWith(
      expect.stringMatching(/cancel it manually in Stripe/i),
      'info',
    );

    await act(async () => root.unmount());
  });

  it('keeps the dialog open and shows the error when the delete fails', async () => {
    apiMock.deleteAdminUser.mockRejectedValue(new Error('Confirmation email does not match the account being deleted.'));

    const { container, root } = await mount();
    await act(async () => { deleteButtonFor(container, 'student@example.com').click(); });
    await flush();
    const input = container.querySelector('#admin-delete-confirm') as HTMLInputElement;
    await typeInto(input, 'student@example.com');
    await act(async () => { buttonByText(container, 'Delete account').click(); });
    await flush();

    expect(container.textContent).toContain('Confirmation email does not match');
    // The account is still there.
    expect(container.textContent).toContain('student@example.com');

    await act(async () => root.unmount());
  });
});
