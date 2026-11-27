/**
 * CollabView — a study group writing one set of notes together.
 *
 * A share link used to be the end of the story: the owner published, and
 * everybody else got a read-only page. This is the other half of that — the
 * screen where a group actually writes, with the people in the room visible.
 *
 * Three things make it a group rather than four people editing separate
 * copies:
 *
 *   - You can see who is here, and who has the note you are reading open.
 *   - A save says which version of the note it started from. If somebody else
 *     got there first, the save is refused and you are shown both versions —
 *     the app never merges rich text on its own, because a merge that guesses
 *     wrong loses writing without telling anybody.
 *   - Deleting is the owner's alone. It is the one change nobody can undo.
 *
 * The decisions live in `utils/collab.ts` (pure, unit-tested) and the server
 * enforces the same rules again in `lib/collabAccess.ts`. The two are not
 * allowed to disagree: the client's copy is for showing the student what is
 * happening, the server's is for deciding whether it happens at all.
 *
 * The live socket is a convenience, not a requirement. If it cannot be
 * opened, the folder still works — saves are still checked, and a reload
 * shows what changed. So a closed socket is reported and then left alone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RichTextEditor from './RichTextEditor';
import { CollabSocket, type CollabServerMessage } from '../lib/collabSocket';
import {
  CollabConflictError,
  createCollabNote,
  deleteCollabNote,
  getCollabFolder,
  getCollabNote,
  getCollabTicket,
  joinWithToken,
  removeMember,
  saveCollabNote,
  setMemberRole,
  type CollabFolder,
  type CollabMember,
} from '../api/collab';
import {
  applyRemote,
  collabCapabilities,
  decideSave,
  isDirty,
  lastEditorLabel,
  openDraft,
  othersEditing,
  othersHere,
  parseTags,
  presenceLabel,
  rebaseOnto,
  sortNotes,
  type CollabDraft,
  type CollabNote,
  type PresenceMember,
} from '../utils/collab';

export interface CollabViewProps {
  /** Join through a share link — how a study-group member arrives. */
  token?: string | null;
  /** Open a folder the student already has access to. */
  folderId?: string | null;
  /** The student's own folders, so they can pick one to open as a group. */
  folders?: Array<{ id: string; name: string }>;
  userId: string;
  userName: string;
  addToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type LiveState = 'connecting' | 'live' | 'offline';
type Pane = 'notes' | 'group';

export default function CollabView({
  token, folderId, folders = [], userId, userName, addToast,
}: CollabViewProps) {
  const [folder, setFolder] = useState<CollabFolder | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('notes');

  /**
   * Which folder is open.
   *
   * A member arrives through a link and never picks one. The owner either
   * arrives with a folder already named (`folderId`, from the URL) or picks
   * one from the list below — so the choice is kept here, next to the view
   * that depends on it.
   */
  const [pickedFolderId, setPickedFolderId] = useState<string | null>(folderId ?? null);
  const activeFolderId = folderId ?? pickedFolderId;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CollabDraft | null>(null);
  const [tagsText, setTagsText] = useState('');

  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [live, setLive] = useState<LiveState>('offline');
  const [connId, setConnId] = useState<string | null>(null);

  /** Somebody saved this note while it was open under a dirty draft. */
  const [superseded, setSuperseded] = useState<{ note: CollabNote; by: string } | null>(null);
  /** The server refused a save; this is what it has now. */
  const [conflict, setConflict] = useState<CollabNote | null>(null);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const socketRef = useRef<CollabSocket | null>(null);
  const draftRef = useRef<CollabDraft | null>(null);
  const selectedRef = useRef<string | null>(null);

  draftRef.current = draft;
  selectedRef.current = selectedId;

  const caps = collabCapabilities(folder?.myRole);
  const editable = caps.canEdit;
  const notes = useMemo(() => (folder ? sortNotes(folder.notes) : []), [folder]);
  const people = useMemo(
    () => (folder?.members ?? []).map(m => ({ userId: m.userId, name: m.name })),
    [folder],
  );

  // ── Loading the folder ───────────────────────────────────────────────────

  const loadFolder = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const loaded = token
        ? await joinWithToken(token)
        : activeFolderId
          ? await getCollabFolder(activeFolderId)
          : null;
      if (!loaded) {
        setState('idle');
        return;
      }
      setFolder(loaded);
      setState('ready');
      setSelectedId(prev => {
        if (prev && loaded.notes.some(n => n.id === prev)) return prev;
        return loaded.notes[0]?.id ?? null;
      });
    } catch (e: any) {
      setError(e?.message || 'This folder could not be opened.');
      setState('error');
    }
  }, [token, activeFolderId]);

  useEffect(() => {
    if (token || activeFolderId) loadFolder();
  }, [token, activeFolderId, loadFolder]);

  // ── The live socket ──────────────────────────────────────────────────────

  const openSocket = useCallback(async (id: string) => {
    setLive('connecting');
    try {
      const { ticket } = await getCollabTicket(id);
      const socket = new CollabSocket();
      socketRef.current = socket;
      socket.connect(id, ticket, {
        onMessage: (msg: CollabServerMessage) => handleSocketMessage(msg),
        onClose: reason => {
          setLive('offline');
          if (reason === 'kicked') {
            setNotice('You were removed from this study group.');
            loadFolder();
          }
        },
      });
    } catch {
      // A closed socket is not a failure. The folder still works without it.
      setLive('offline');
    }
  }, []);

  useEffect(() => {
    if (!folder) return;
    openSocket(folder.folderId);
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
      setLive('offline');
    };
  }, [folder?.folderId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A note changed on the server. Fetch it and decide what to do with it. */
  const refreshNote = useCallback(async (noteId: string) => {
    if (!folder) return;
    try {
      const incoming = await getCollabNote(folder.folderId, noteId);
      const current = draftRef.current;
      const decision = applyRemote(current && current.noteId === noteId ? current : null, incoming);

      if (decision.kind === 'keep') {
        setSuperseded({ note: incoming, by: incoming.lastEditedBy ?? '' });
        return;
      }
      setSuperseded(null);
      // Not the note on screen, or nothing typed: just take the new version.
      if (current?.noteId === noteId) {
        setDraft(decision.draft);
        setTagsText(decision.draft.tags.join(', '));
      } else {
        setFolder(f => (f ? { ...f, notes: f.notes.map(n => (n.id === noteId ? incoming : n)) } : f));
      }
    } catch {
      // The note may have been deleted between the message and the fetch.
      loadFolder();
    }
  }, [folder, loadFolder]);

  function handleSocketMessage(msg: CollabServerMessage) {
    switch (msg.type) {
      case 'welcome':
        setConnId(msg.connId);
        setPresence(msg.members);
        setLive('live');
        break;
      case 'presence':
        setPresence(msg.members);
        break;
      case 'note-updated':
        if (msg.noteId === selectedRef.current) refreshNote(msg.noteId);
        else setFolder(f => (f ? { ...f, notes: f.notes.map(n => (n.id === msg.noteId ? { ...n, updatedAt: new Date().toISOString() } : n)) } : f));
        break;
      case 'note-created':
      case 'note-deleted':
      case 'group-changed':
        loadFolder();
        break;
      case 'kicked':
        setNotice(msg.message);
        setLive('offline');
        break;
      default:
        break;
    }
  }

  // ── Selecting a note ─────────────────────────────────────────────────────

  const selectNote = useCallback((note: CollabNote) => {
    setSelectedId(note.id);
    setDraft(openDraft(note));
    setTagsText(note.tags.join(', '));
    setSuperseded(null);
    setConflict(null);
    socketRef.current?.setEditing(note.id);
  }, []);

  // Keep the draft in step with the note list, so a note that changed under
  // the list is not saved over silently.
  useEffect(() => {
    if (!folder || !selectedId) return;
    const listNote = folder.notes.find(n => n.id === selectedId);
    if (!listNote) return;
    if (draftRef.current && draftRef.current.noteId === selectedId && isDirty(draftRef.current)) return;
    setDraft(openDraft(listNote));
    setTagsText(listNote.tags.join(', '));
  }, [folder, selectedId]);

  // ── Saving ───────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!folder || !draft) return;
    const decision = decideSave(draft, folder.notes.find(n => n.id === draft.noteId));
    if (decision.kind === 'unchanged') return;
    if (decision.kind === 'gone') {
      setNotice('That note is no longer in the folder.');
      loadFolder();
      return;
    }
    if (decision.kind === 'conflict') {
      setConflict(decision.theirs);
      return;
    }

    setSaving(true);
    try {
      const saved = await saveCollabNote(folder.folderId, draft, connId ?? undefined);
      setDraft(openDraft(saved));
      setTagsText(saved.tags.join(', '));
      setFolder(f => (f ? { ...f, notes: f.notes.map(n => (n.id === saved.id ? saved : n)) } : f));
      setSuperseded(null);
      setConflict(null);
      addToast?.('Saved.', 'success');
    } catch (e: any) {
      if (e instanceof CollabConflictError) {
        setConflict(e.current);
      } else {
        addToast?.(e?.message || 'The save did not go through.', 'error');
      }
    } finally {
      setSaving(false);
    }
  }, [folder, draft, connId, addToast, loadFolder]);

  /** "Keep mine" — the student has seen what they are overwriting. */
  const keepMine = useCallback(async () => {
    if (!draft || !conflict) return;
    const rebased = rebaseOnto(draft, conflict);
    setDraft(rebased);
    setConflict(null);
    // Save straight away: the student has already made the call.
    try {
      const saved = await saveCollabNote(folder!.folderId, rebased, connId ?? undefined);
      setDraft(openDraft(saved));
      setTagsText(saved.tags.join(', '));
      setFolder(f => (f ? { ...f, notes: f.notes.map(n => (n.id === saved.id ? saved : n)) } : f));
      addToast?.('Your version was saved.', 'success');
    } catch (e: any) {
      if (e instanceof CollabConflictError) setConflict(e.current);
      else addToast?.(e?.message || 'The save did not go through.', 'error');
    }
  }, [draft, conflict, folder, connId, addToast]);

  /** "Take theirs" — their words become the draft. */
  const takeTheirs = useCallback(() => {
    if (!conflict) return;
    setDraft(openDraft(conflict));
    setTagsText(conflict.tags.join(', '));
    setConflict(null);
    setSuperseded(null);
  }, [conflict]);

  // ── Notes ────────────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!folder || !editable) return;
    try {
      const created = await createCollabNote(
        folder.folderId,
        { title: 'Untitled', content: '', tags: [] },
        connId ?? undefined,
      );
      setFolder(f => (f ? { ...f, notes: [created, ...f.notes] } : f));
      selectNote(created);
    } catch (e: any) {
      addToast?.(e?.message || 'The note could not be created.', 'error');
    }
  }, [folder, editable, connId, selectNote, addToast]);

  const handleDelete = useCallback(async (noteId: string) => {
    if (!folder) return;
    try {
      await deleteCollabNote(folder.folderId, noteId);
      setFolder(f => (f ? { ...f, notes: f.notes.filter(n => n.id !== noteId) } : f));
      if (selectedId === noteId) {
        setSelectedId(null);
        setDraft(null);
      }
      addToast?.('Note deleted.', 'success');
    } catch (e: any) {
      addToast?.(e?.message || 'The note could not be deleted.', 'error');
    }
  }, [folder, selectedId, addToast]);

  // ── The group ────────────────────────────────────────────────────────────

  const handleRole = useCallback(async (member: CollabMember, role: 'viewer' | 'editor') => {
    if (!folder || !member.memberId) return;
    try {
      await setMemberRole(folder.folderId, member.memberId, role);
      setFolder(f => (f ? { ...f, members: f.members.map(m => (m.memberId === member.memberId ? { ...m, role } : m)) } : f));
    } catch (e: any) {
      addToast?.(e?.message || 'That change did not go through.', 'error');
    }
  }, [folder, addToast]);

  const handleRemove = useCallback(async (member: CollabMember) => {
    if (!folder || !member.memberId) return;
    try {
      await removeMember(folder.folderId, member.memberId);
      setFolder(f => (f ? { ...f, members: f.members.filter(m => m.memberId !== member.memberId) } : f));
      addToast?.(`${member.name} was removed.`, 'success');
    } catch (e: any) {
      addToast?.(e?.message || 'They could not be removed.', 'error');
    }
  }, [folder, addToast]);

  // ── Rendering ────────────────────────────────────────────────────────────

  if (state === 'error') {
    return (
      <div className="sw-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ marginBottom: '1rem' }}>{error}</p>
        <button className="btn btn-secondary" onClick={loadFolder}>Try again</button>
      </div>
    );
  }

  // No folder yet: ask which one. This is the owner's way in — a member
  // arrives through a link and never sees this.
  if (!token && !activeFolderId) {
    return (
      <div className="sw-panel" style={{ padding: '1.5rem' }}>
        <div className="sw-panel-head">
          <h2 className="sw-panel-title">Study groups</h2>
          <p className="sw-panel-sub">
            Open one of your folders as a study group. Share it with an editor link and
            your classmates can write in it with you.
          </p>
        </div>
        {folders.length === 0 ? (
          <p className="text-muted" style={{ marginTop: '1rem' }}>
            You have no folders yet. Create one in Notes first.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            {folders.map(f => (
              <button
                key={f.id}
                className="sw-btn secondary block"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => setPickedFolderId(f.id)}
              >
                📁 {f.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (state === 'loading' || !folder) {
    return <div className="sw-panel" style={{ padding: '2rem' }}><p className="text-muted">Opening the folder…</p></div>;
  }

  const here = othersHere(presence, userId);
  const onThisNote = draft ? othersEditing(presence, draft.noteId, userId) : [];
  const dirty = draft ? isDirty(draft) : false;

  return (
    <div className="collab-view">
      {/* ── The room ─────────────────────────────────────────────────────── */}
      <header className="collab-head">
        <div className="collab-head-main">
          <div className="collab-head-title">
            📁 {folder.folderName}
            <span className={`collab-role ${folder.myRole}`}>{folder.myRole}</span>
          </div>
          <div className="collab-head-sub">
            <span className={`collab-live ${live}`}>
              {live === 'live' ? '● Live' : live === 'connecting' ? '○ Connecting' : '○ Offline'}
            </span>
            <span>·</span>
            <span>{presenceLabel(presence, userId)}</span>
          </div>
        </div>
        <div className="collab-head-side">
          {presence.length > 0 && (
            <div className="collab-avatars">
              {/* You first, then everybody else — so the row reads as "the
                  people in this room", not "the people who are not you". */}
              <span className="collab-avatar self" title={`${userName} (you)`}>
                {userName.slice(0, 1).toUpperCase()}
              </span>
              {here.map(m => (
                <span key={m.userId} className="collab-avatar" title={m.name}>
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
          )}
          {caps.canManageGroup && (
            <button className="btn btn-secondary btn-sm" onClick={() => setPane(pane === 'group' ? 'notes' : 'group')}>
              {pane === 'group' ? '← Notes' : `Group (${folder.members.length})`}
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div className="collab-notice">
          {notice}
          <button className="btn btn-ghost btn-xs" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="collab-body">
        {/* ── The list (or the group) ───────────────────────────────────── */}
        <aside className="collab-side">
          {pane === 'notes' ? (
            <>
              {editable && (
                <button className="btn btn-primary btn-sm collab-new" onClick={handleCreate}>
                  + New note
                </button>
              )}
              <div className="collab-notes">
                {notes.length === 0 && <p className="text-muted" style={{ padding: '1rem' }}>No notes yet.</p>}
                {notes.map(n => {
                  const others = othersEditing(presence, n.id, userId);
                  const active = n.id === selectedId;
                  return (
                    <button
                      key={n.id}
                      className={`collab-note ${active ? 'active' : ''}`}
                      onClick={() => selectNote(n)}
                    >
                      <span className="collab-note-title">{n.title || 'Untitled'}</span>
                      <span className="collab-note-meta">
                        {others.length > 0 && <span className="collab-note-live" title={others.map(o => o.name).join(', ')}>●</span>}
                        {lastEditorLabel(n, people, userId) && (
                          <span className="collab-note-by">{lastEditorLabel(n, people, userId)}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="collab-group">
              <h3 className="sw-panel-title" style={{ marginBottom: '0.75rem' }}>The group</h3>
              {folder.members.map(m => (
                <div key={m.userId} className="collab-member">
                  <span className="collab-avatar">{m.name.slice(0, 1).toUpperCase()}</span>
                  <div className="collab-member-main">
                    <div className="collab-member-name">
                      {m.name}
                      {m.userId === userId && <span className="text-muted"> (you)</span>}
                    </div>
                    <div className="collab-member-sub">
                      {m.role === 'owner'
                        ? 'Owns the folder'
                        : m.lastSeenAt
                          ? `Last seen ${new Date(m.lastSeenAt).toLocaleDateString()}`
                          : 'Has not opened it yet'}
                    </div>
                  </div>
                  {m.role !== 'owner' && m.memberId && (
                    <div className="collab-member-actions">
                      <select
                        className="select"
                        value={m.role}
                        onChange={e => handleRole(m, e.target.value as 'viewer' | 'editor')}
                        aria-label={`Role for ${m.name}`}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => handleRemove(m)}
                        aria-label={`Remove ${m.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted" style={{ marginTop: '1rem' }}>
                An editor can add and change notes. Only you can delete them.
              </p>
            </div>
          )}
        </aside>

        {/* ── The note ──────────────────────────────────────────────────── */}
        <section className="collab-main">
          {!draft ? (
            <div className="sw-panel" style={{ padding: '2rem' }}>
              <p className="text-muted">Pick a note on the left to start writing.</p>
            </div>
          ) : (
            <>
              {/* Somebody else saved this note while it was open under a
                  dirty draft. The draft is kept — the student decides. */}
              {superseded && (
                <div className="collab-conflict">
                  <div className="collab-conflict-head">
                    <strong>This note changed while you were typing.</strong>
                    <span className="text-muted">
                      {superseded.by ? `${superseded.by} saved a newer version.` : 'Somebody saved a newer version.'}
                    </span>
                  </div>
                  <div className="collab-conflict-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                      setDraft(openDraft(superseded.note));
                      setTagsText(superseded.note.tags.join(', '));
                      setSuperseded(null);
                    }}>
                      Take theirs
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSuperseded(null)}>
                      Keep editing mine
                    </button>
                  </div>
                </div>
              )}

              {/* The server refused a save. Both versions, side by side. */}
              {conflict && (
                <div className="collab-conflict">
                  <div className="collab-conflict-head">
                    <strong>Somebody saved this note first.</strong>
                    <span className="text-muted">Nothing of yours has been lost. Choose which version to keep.</span>
                  </div>
                  <div className="collab-conflict-grid">
                    <div className="collab-version">
                      <div className="collab-version-head">Yours</div>
                      <div className="collab-version-body">{draft.content || <em>(empty)</em>}</div>
                    </div>
                    <div className="collab-version">
                      <div className="collab-version-head">Theirs</div>
                      <div className="collab-version-body">{conflict.content || <em>(empty)</em>}</div>
                    </div>
                  </div>
                  <div className="collab-conflict-actions">
                    <button className="btn btn-primary btn-sm" onClick={keepMine}>Keep mine</button>
                    <button className="btn btn-secondary btn-sm" onClick={takeTheirs}>Take theirs</button>
                  </div>
                </div>
              )}

              <input
                className="input collab-title"
                value={draft.title}
                onChange={e => setDraft({ ...draft, title: e.target.value })}
                placeholder="Title"
                disabled={!editable}
                aria-label="Note title"
              />

              {editable ? (
                <RichTextEditor
                  value={draft.content}
                  onChange={html => setDraft(d => (d ? { ...d, content: html } : d))}
                  placeholder="Write with the group…"
                  minHeight="320px"
                />
              ) : (
                <div
                  className="collab-readonly"
                  dangerouslySetInnerHTML={{ __html: draft.content || '<p><em>This note is empty.</em></p>' }}
                />
              )}

              <div className="collab-foot">
                <input
                  className="input collab-tags"
                  value={tagsText}
                  onChange={e => {
                    setTagsText(e.target.value);
                    setDraft(d => (d ? { ...d, tags: parseTags(e.target.value) } : d));
                  }}
                  placeholder="Tags, separated by commas"
                  disabled={!editable}
                  aria-label="Tags"
                />
                <div className="collab-foot-right">
                  {onThisNote.length > 0 && (
                    <span className="text-xs text-muted">
                      {onThisNote.map(o => o.name).join(', ')} {onThisNote.length === 1 ? 'is' : 'are'} also here
                    </span>
                  )}
                  {editable && (
                    <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !dirty}>
                      {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                    </button>
                  )}
                  {caps.canDelete && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(draft.noteId)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
