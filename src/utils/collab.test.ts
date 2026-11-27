/**
 * Tests for the collaboration decisions.
 *
 * The whole feature rests on one promise: two people editing the same note
 * never silently lose each other's writing. These tests are that promise,
 * stated case by case.
 */
import { describe, it, expect } from 'vitest';
import {
  applyRemote,
  canEdit,
  decideSave,
  isDirty,
  isStale,
  joinNames,
  lastEditorLabel,
  openDraft,
  othersEditing,
  othersHere,
  parseTags,
  presenceLabel,
  rebaseOnto,
  sortNotes,
  type CollabNote,
  type PresenceMember,
} from './collab';

const T1 = '2026-11-20T10:00:00.000Z';
const T2 = '2026-11-20T10:01:00.000Z';
const T3 = '2026-11-20T10:02:00.000Z';

const v1: CollabNote = {
  id: 'n1', title: 'Photosynthesis', content: '<p>Light in.</p>', tags: ['plants'],
  revision: 1, updatedAt: T1, lastEditedBy: 'owner',
};
/** The same note after somebody else saved it. */
const v2: CollabNote = { ...v1, content: '<p>Light in, sugar out.</p>', revision: 2, updatedAt: T2, lastEditedBy: 'ada' };

describe('canEdit', () => {
  it('lets the owner and editors write, and nobody else', () => {
    expect(canEdit('owner')).toBe(true);
    expect(canEdit('editor')).toBe(true);
    expect(canEdit('viewer')).toBe(false);
    expect(canEdit(undefined)).toBe(false);
  });
});

describe('isDirty', () => {
  it('a freshly opened note is clean', () => {
    expect(isDirty(openDraft(v1))).toBe(false);
  });

  it('typing in the body makes it dirty', () => {
    expect(isDirty({ ...openDraft(v1), content: '<p>More.</p>' })).toBe(true);
  });

  it('changing the title makes it dirty', () => {
    expect(isDirty({ ...openDraft(v1), title: 'Photosynthesis, revised' })).toBe(true);
  });

  it('changing the tags makes it dirty', () => {
    expect(isDirty({ ...openDraft(v1), tags: ['plants', 'bio'] })).toBe(true);
  });

  it('typing and then undoing it leaves the note clean', () => {
    const draft = openDraft(v1);
    expect(isDirty({ ...draft, content: '<p>changed</p>' })).toBe(true);
    expect(isDirty({ ...draft, content: v1.content })).toBe(false);
  });

  it('does not alias the note\u2019s tags', () => {
    const draft = openDraft(v1);
    draft.tags.push('bio');
    expect(v1.tags).toEqual(['plants']);
  });
});

describe('isStale', () => {
  it('the same version is not stale', () => {
    expect(isStale(v1, v1)).toBe(false);
  });

  it('a newer save is stale', () => {
    expect(isStale(v1, v2)).toBe(true);
  });

  it('goes by the time and the revision, so either alone is enough', () => {
    // Two saves inside the same millisecond differ only by revision.
    expect(isStale(v1, { ...v1, revision: 2 })).toBe(true);
    // The owner's own sync moves the time but never the revision.
    expect(isStale(v1, { ...v1, updatedAt: T3 })).toBe(true);
  });
});

describe('decideSave', () => {
  it('saves a clean change when nobody else has touched the note', () => {
    const draft = { ...openDraft(v1), content: '<p>Mine.</p>' };
    expect(decideSave(draft, v1)).toEqual({ kind: 'save' });
  });

  it('sends nothing when nothing changed', () => {
    expect(decideSave(openDraft(v1), v1)).toEqual({ kind: 'unchanged' });
  });

  it('refuses to save over somebody else\u2019s version', () => {
    const draft = { ...openDraft(v1), content: '<p>Mine.</p>' };
    expect(decideSave(draft, v2)).toEqual({ kind: 'conflict', theirs: v2 });
  });

  it('has nothing to save from a clean draft, even if the note moved on', () => {
    // Nothing was typed, so nothing can be lost. Refreshing what is on screen
    // is applyRemote's job when the newer version arrives, not the save's.
    expect(decideSave(openDraft(v1), v2)).toEqual({ kind: 'unchanged' });
  });

  it('says the note is gone rather than calling it a conflict', () => {
    const draft = { ...openDraft(v1), content: '<p>Mine.</p>' };
    expect(decideSave(draft, undefined)).toEqual({ kind: 'gone' });
  });

  it('saves again after the draft was rebased onto the newer version', () => {
    const typed = { ...openDraft(v1), content: '<p>Mine.</p>' };
    expect(decideSave(rebaseOnto(typed, v2), v2)).toEqual({ kind: 'save' });
  });
});

describe('applyRemote', () => {
  it('shows a reader the new text', () => {
    const result = applyRemote(openDraft(v1), v2);
    expect(result.kind).toBe('replace');
    expect(result.kind === 'replace' && result.draft.content).toBe(v2.content);
  });

  it('does not take the words out from under someone who is typing', () => {
    const typing = { ...openDraft(v1), content: '<p>Half a sentence' };
    const result = applyRemote(typing, v2);

    expect(result.kind).toBe('keep');
    if (result.kind === 'keep') {
      // Exactly what they typed, still there.
      expect(result.draft.content).toBe('<p>Half a sentence');
      expect(result.supersededBy).toEqual(v2);
    }
  });

  it('ignores a change to a different note', () => {
    const typing = { ...openDraft(v1), content: '<p>Half a sentence' };
    const other = { ...v2, id: 'n9' };
    const result = applyRemote(typing, other);
    expect(result.kind).toBe('replace');
    if (result.kind === 'replace') expect(result.draft.noteId).toBe('n9');
  });

  it('opens the note when nothing was open', () => {
    const result = applyRemote(null, v2);
    expect(result.kind).toBe('replace');
    if (result.kind === 'replace') {
      expect(result.draft.noteId).toBe('n1');
      expect(result.draft.content).toBe(v2.content);
    }
  });
});

describe('rebaseOnto', () => {
  it('keeps the typing and takes the newer base', () => {
    const typed = { ...openDraft(v1), content: '<p>Mine, complete.</p>' };
    const rebased = rebaseOnto(typed, v2);

    expect(rebased.content).toBe('<p>Mine, complete.</p>');
    expect(rebased.base).toBe(v2);
    // It is still a change, now relative to the latest version.
    expect(isDirty(rebased)).toBe(true);
  });
});

describe('presence', () => {
  const ada: PresenceMember = { userId: 'ada', name: 'Ada', noteId: 'n1' };
  const grace: PresenceMember = { userId: 'grace', name: 'Grace', noteId: 'n2' };
  const tim: PresenceMember = { userId: 'tim', name: 'Tim' };
  const me: PresenceMember = { userId: 'me', name: 'Me', noteId: 'n1' };
  const room = [me, ada, grace, tim];

  it('knows who else has the same note open', () => {
    expect(othersEditing(room, 'n1', 'me').map(m => m.userId)).toEqual(['ada']);
    expect(othersEditing(room, 'n2', 'me').map(m => m.userId)).toEqual(['grace']);
    expect(othersEditing(room, 'n3', 'me')).toEqual([]);
    // Never yourself, however many tabs you have open.
    expect(othersEditing([...room, { ...me }], 'n1', 'me').map(m => m.userId)).toEqual(['ada']);
  });

  it('lists everyone else, in a stable order, without duplicates per self', () => {
    expect(othersHere(room, 'me').map(m => m.name)).toEqual(['Ada', 'Grace', 'Tim']);
    expect(othersHere([me], 'me')).toEqual([]);
  });

  it('does not reorder the list it was given', () => {
    const before = room.map(m => m.userId).join();
    othersHere(room, 'me');
    expect(room.map(m => m.userId).join()).toBe(before);
  });

  it('joins names into one phrase', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Ada'])).toBe('Ada');
    expect(joinNames(['Ada', 'Grace'])).toBe('Ada and Grace');
    expect(joinNames(['Ada', 'Grace', 'Tim'])).toBe('Ada, Grace and Tim');
    // The same person in two tabs is still one person.
    expect(joinNames(['Ada', 'Ada', 'Tim'])).toBe('Ada and Tim');
  });

  it('describes who is here', () => {
    expect(presenceLabel([me], 'me')).toBe('You are the only one here.');
    expect(presenceLabel([me, ada], 'me')).toBe('Ada is here.');
    expect(presenceLabel(room, 'me')).toBe('Ada, Grace and Tim are here.');
  });
});

describe('lastEditorLabel', () => {
  const people = [{ userId: 'owner', name: 'Owen' }, { userId: 'ada', name: 'Ada' }];

  it('is nothing for a note nobody has changed', () => {
    expect(lastEditorLabel({ lastEditedBy: null, revision: 0 }, people, 'me')).toBeNull();
  });

  it('is "you" for your own edit', () => {
    expect(lastEditorLabel({ lastEditedBy: 'me', revision: 2 }, people, 'me')).toBe('you');
  });

  it('names whoever made the edit', () => {
    expect(lastEditorLabel({ lastEditedBy: 'ada', revision: 2 }, people, 'me')).toBe('Ada');
  });

  it('does not invent a name for somebody it cannot name', () => {
    expect(lastEditorLabel({ lastEditedBy: 'gone', revision: 2 }, people, 'me')).toBe('someone else');
  });
});

describe('parseTags', () => {
  it('splits on commas, trims, drops empties and repeats', () => {
    expect(parseTags('plants, bio , ,plants,')).toEqual(['plants', 'bio']);
  });

  it('is an empty list for no input', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags(' , ')).toEqual([]);
  });

  it('keeps a tag to a sensible length and count', () => {
    const long = 'x'.repeat(200);
    expect(parseTags(long)[0]).toHaveLength(80);
    const many = Array.from({ length: 60 }, (_, i) => `t${i}`).join(',');
    expect(parseTags(many)).toHaveLength(40);
  });
});

describe('sortNotes', () => {
  it('puts the most recently changed note first', () => {
    const a = { ...v1, id: 'a', updatedAt: T1 };
    const b = { ...v1, id: 'b', updatedAt: T3 };
    const c = { ...v1, id: 'c', updatedAt: T2 };
    expect(sortNotes([a, c, b]).map(n => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie on title, so the list does not jump around', () => {
    const a = { ...v1, id: 'a', title: 'Zebra', updatedAt: T1 };
    const b = { ...v1, id: 'b', title: 'Apple', updatedAt: T1 };
    expect(sortNotes([a, b]).map(n => n.id)).toEqual(['b', 'a']);
  });

  it('does not reorder the list it was given', () => {
    const list = [v2, v1];
    sortNotes(list);
    expect(list[0]).toBe(v2);
  });
});
