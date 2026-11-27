/**
 * collab — the decisions behind editing a note that other people can edit.
 *
 * Two people with the same note open will eventually save at the same
 * time. The question is what happens next, and the answer has to be the same
 * whether the other person's save arrived a second ago or a millisecond ago.
 *
 * So everything below is a pure function of two things: the *draft* (what is
 * on screen, and the version of the note it was typed into) and the *note*
 * (what the server last said). From those it decides whether the draft has
 * unsaved work, whether the note has moved on underneath it, and who else is
 * looking at it.
 *
 * The rule for the hard case is deliberately not a merge. When the note has
 * changed under a draft with unsaved typing, the person is shown both and
 * asked. Rich text cannot be merged by guesswork, and a merge that guesses
 * wrong loses writing without telling anyone — which is worse than a
 * question.
 */

export type CollabRole = 'owner' | 'editor' | 'viewer';

export interface CollabNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  revision: number;
  updatedAt: string;
  lastEditedBy: string | null;
}

/** Somebody connected to the folder right now. */
export interface PresenceMember {
  userId: string;
  name: string;
  /** The note they have open, if any. */
  noteId?: string;
}

/** What is on screen, and the version of the note it was typed into. */
export interface CollabDraft {
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  /** The note as it was when the draft was started or last saved. */
  base: CollabNote;
}

export function canEdit(role: CollabRole | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

/**
 * What a role may do, in one place.
 *
 * The three rules are different in kind and it is easy to blur them:
 *
 *   - Writing (changing a note, adding one) is for the owner and editors.
 *   - Deleting is the owner's alone. It is the one change nobody can undo,
 *     so removing somebody else's work is not a decision an editor should be
 *     able to make on the owner's behalf.
 *   - Managing the group — promoting, demoting, removing people — is also
 *     the owner's alone, for the same reason: it is about who else is here.
 *
 * A viewer can read and nothing else.
 */
export interface CollabCapabilities {
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  canManageGroup: boolean;
}

export function collabCapabilities(role: CollabRole | undefined): CollabCapabilities {
  const owner = role === 'owner';
  return {
    canEdit: canEdit(role),
    canDelete: owner,
    canCreate: canEdit(role),
    canManageGroup: owner,
  };
}

/** A fresh draft for a note: on screen is exactly what is on the server. */
export function openDraft(note: CollabNote): CollabDraft {
  return { noteId: note.id, title: note.title, content: note.content, tags: [...note.tags], base: note };
}

/** True when anything has been typed since the draft was last saved. */
export function isDirty(draft: CollabDraft): boolean {
  return draft.title !== draft.base.title
    || draft.content !== draft.base.content
    || draft.tags.join('\u0000') !== draft.base.tags.join('\u0000');
}

/**
 * True when `current` is a newer version of the note than `base`.
 *
 * Both fields are compared because the server refuses a save unless both
 * still match: `updatedAt` is moved by every write, including the owner's
 * own sync, and the revision closes the millisecond gap.
 */
export function isStale(base: CollabNote, current: CollabNote): boolean {
  return base.updatedAt !== current.updatedAt || base.revision !== current.revision;
}

export type SaveDecision =
  | { kind: 'save' }
  /** Nothing to send. */
  | { kind: 'unchanged' }
  /** The note changed under the draft; `theirs` is what is on the server now. */
  | { kind: 'conflict'; theirs: CollabNote }
  /** The note is no longer in the folder. */
  | { kind: 'gone' };

/**
 * Decide what to do when the person presses save.
 *
 * This is checked before anything is sent, so the common case — the other
 * person's save arrived a moment ago and the list already knows about it —
 * never makes a request. The server runs the same check again inside the
 * write, for the case where the two saves really did cross.
 */
export function decideSave(draft: CollabDraft, current: CollabNote | undefined): SaveDecision {
  if (!current) return { kind: 'gone' };
  if (!isDirty(draft)) return { kind: 'unchanged' };
  if (isStale(draft.base, current)) return { kind: 'conflict', theirs: current };
  return { kind: 'save' };
}

export type RemoteDecision =
  /** The draft had no unsaved typing, so it becomes the new version. */
  | { kind: 'replace'; draft: CollabDraft }
  /** There is typing to protect; the draft stays and the person is told. */
  | { kind: 'keep'; draft: CollabDraft; supersededBy: CollabNote };

/**
 * Decide what to do with an open draft when the server says its note changed.
 *
 * Someone who is only reading should simply see the new text. Someone who is
 * typing must not have it swapped out from under them.
 */
export function applyRemote(draft: CollabDraft | null, incoming: CollabNote): RemoteDecision {
  if (!draft || draft.noteId !== incoming.id) {
    return { kind: 'replace', draft: openDraft(incoming) };
  }
  if (!isDirty(draft)) {
    return { kind: 'replace', draft: openDraft(incoming) };
  }
  return { kind: 'keep', draft, supersededBy: incoming };
}

/**
 * Adopt somebody else's version as the new starting point, keeping what was
 * typed. This is what "keep mine and save anyway" does: the draft's words
 * stay, and its base becomes theirs, so the next save is accepted.
 *
 * The person has chosen to overwrite, and they were shown what they are
 * overwriting. It is their writing and their call.
 */
export function rebaseOnto(draft: CollabDraft, theirs: CollabNote): CollabDraft {
  return { ...draft, base: theirs };
}

/** Everyone else who has this note open right now. */
export function othersEditing(members: PresenceMember[], noteId: string, selfId: string): PresenceMember[] {
  return members.filter(m => m.userId !== selfId && m.noteId === noteId);
}

/** Everyone else in the folder, in a stable order. */
export function othersHere(members: PresenceMember[], selfId: string): PresenceMember[] {
  return members
    .filter(m => m.userId !== selfId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

/** "Ada", "Ada and Grace", "Ada, Grace and Tim". */
export function joinNames(names: string[]): string {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/** Who is here, as one sentence: "Ada and Grace are here". */
export function presenceLabel(members: PresenceMember[], selfId: string): string {
  const others = othersHere(members, selfId);
  if (others.length === 0) return 'You are the only one here.';
  return `${joinNames(others.map(m => m.name))} ${others.length === 1 ? 'is' : 'are'} here.`;
}

/**
 * The name to show beside a note for who last changed it.
 *
 * Returns null for a note nobody has changed yet, and "you" for your own
 * edits — "last edited by you" reads better than your own name.
 *
 * `people` is whoever the caller can name: the whole group if the folder has
 * been loaded, which is most cases. Somebody who has since been removed is
 * still named if they are in that list.
 */
export function lastEditorLabel(
  note: Pick<CollabNote, 'lastEditedBy' | 'revision'>,
  people: Array<{ userId: string; name: string }>,
  selfId: string,
): string | null {
  if (!note.lastEditedBy) return null;
  if (note.lastEditedBy === selfId) return 'you';
  return people.find(p => p.userId === note.lastEditedBy)?.name ?? 'someone else';
}

/** Tags as a person types them — commas, with the empties dropped. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const t = raw.trim().slice(0, 80);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 40) break;
  }
  return out;
}

/** Most recently changed first, with a stable order for ties. */
export function sortNotes(notes: CollabNote[]): CollabNote[] {
  return notes
    .slice()
    .sort((a, b) => (b.updatedAt.localeCompare(a.updatedAt)) || a.title.localeCompare(b.title));
}
