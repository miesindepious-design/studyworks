import { useState, useMemo } from 'react';
import { Contact, Folder, StudyGroup } from '../types';

type Tier = 'free' | 'pro';

interface ContactsViewProps {
  contacts: Contact[];
  setContacts: (contacts: Contact[]) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  tier: Tier;
  setCurrentView: (view: string) => void;
  totalItems: number;
  folders: Folder[];
  setFolders: (folders: Folder[]) => void;
}

function fmtDateTime(date: Date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function isOverdue(date: Date) { return new Date(date) < new Date(); }

function daysSince(date: Date | undefined) {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getStrength(days: number | null): 'weak' | 'moderate' | 'strong' {
  if (days === null) return 'moderate';
  if (days <= 7) return 'strong';
  if (days <= 30) return 'moderate';
  return 'weak';
}

function strengthColor(s: 'weak' | 'moderate' | 'strong') {
  if (s === 'strong') return 'var(--success)';
  if (s === 'moderate') return 'var(--accent)';
  return 'var(--danger)';
}

export default function ContactsView({ contacts, setContacts, addToast, tier, setCurrentView, totalItems, folders, setFolders }: ContactsViewProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [nextReminder, setNextReminder] = useState('');
  const [lastContacted, setLastContacted] = useState('');
  const [tags, setTags] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('default');
  const [newFolderName, setNewFolderName] = useState('');
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [birthday, setBirthday] = useState('');
  const [relationshipStrength, setRelationshipStrength] = useState<'weak' | 'moderate' | 'strong'>('moderate');

  // Study groups
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [groupName, setGroupName] = useState('');
  const [activeGroup, setActiveGroup] = useState<StudyGroup | null>(null);
  const [groupMessage, setGroupMessage] = useState('');

  // Bulk action modals
  const [bulkTag, setBulkTag] = useState('');
  const [bulkFolder, setBulkFolder] = useState('');
  const [bulkReminder, setBulkReminder] = useState('');

  const toggleBulkSelect = (id: string) => setBulkSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const bulkDelete = () => {
    if (bulkSelected.size === 0) return;
    if (!confirm(`Delete ${bulkSelected.size} contact${bulkSelected.size > 1 ? 's' : ''}?`)) return;
    setContacts(contacts.filter(c => !bulkSelected.has(c.id)));
    setBulkSelected(new Set()); setBulkMode(false);
    addToast(`Deleted ${bulkSelected.size} contact${bulkSelected.size > 1 ? 's' : ''}.`, 'success');
  };

  const bulkTagApply = () => {
    if (!bulkTag.trim() || bulkSelected.size === 0) return;
    setContacts(contacts.map(c => bulkSelected.has(c.id) ? { ...c, tags: [...new Set([...c.tags, bulkTag.trim()])] } : c));
    setBulkTag(''); setBulkSelected(new Set()); setBulkMode(false);
    addToast(`Tagged ${bulkSelected.size} contacts.`, 'success');
  };

  const bulkFolderApply = () => {
    if (!bulkFolder || bulkSelected.size === 0) return;
    setContacts(contacts.map(c => bulkSelected.has(c.id) ? { ...c, folderId: bulkFolder } : c));
    setBulkFolder(''); setBulkSelected(new Set()); setBulkMode(false);
    addToast(`Moved ${bulkSelected.size} contacts.`, 'success');
  };

  const bulkReminderApply = () => {
    if (!bulkReminder || bulkSelected.size === 0) return;
    setContacts(contacts.map(c => bulkSelected.has(c.id) ? { ...c, nextReminder: new Date(bulkReminder) } : c));
    setBulkReminder(''); setBulkSelected(new Set()); setBulkMode(false);
    addToast(`Reminder set for ${bulkSelected.size} contacts.`, 'success');
  };

  const clearForm = () => { setName(''); setRole(''); setEmail(''); setPhone(''); setNotes(''); setNextReminder(''); setLastContacted(''); setTags(''); setBirthday(''); setRelationshipStrength('moderate'); };

  const addFolder = () => {
    if (tier !== 'pro') { addToast('Folders are a Pro feature!', 'info'); setCurrentView('pricing'); return; }
    if (newFolderName.trim()) { setFolders([...folders, { id: Date.now().toString(), name: newFolderName.trim(), createdAt: new Date() }]); setNewFolderName(''); addToast('Folder added!', 'success'); }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingContact) {
      setContacts(contacts.map(c => c.id === editingContact.id ? {
        ...c, name, role,
        email: email || undefined,
        phone: phone || undefined,
        notes: notes || undefined,
        nextReminder: nextReminder ? new Date(nextReminder) : undefined,
        lastContacted: lastContacted ? new Date(lastContacted) : c.lastContacted,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        folderId: selectedFolder,
        birthday: birthday ? new Date(birthday) : undefined,
        relationshipStrength,
        studyGroupIds: c.studyGroupIds,
      } : c));
      setEditingContact(null); setFormOpen(false); clearForm(); addToast('Contact updated!', 'success');
    } else {
      if (tier === 'free' && totalItems >= 50) { addToast('50 item limit reached. Upgrade to Pro.', 'info'); setCurrentView('pricing'); return; }
      setContacts([{
        id: Date.now().toString(), name, role,
        email: email || undefined,
        phone: phone || undefined,
        notes: notes || undefined,
        nextReminder: nextReminder ? new Date(nextReminder) : undefined,
        lastContacted: lastContacted ? new Date(lastContacted) : undefined,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        folderId: selectedFolder,
        birthday: birthday ? new Date(birthday) : undefined,
        relationshipStrength,
        studyGroupIds: [],
      }, ...contacts]);
      clearForm(); setFormOpen(false); addToast('Contact added!', 'success');
    }
  };

  const startEdit = (c: Contact) => {
    setEditingContact(c);
    setName(c.name); setRole(c.role); setEmail(c.email||''); setPhone(c.phone||'');
    setNotes(c.notes||''); setNextReminder(c.nextReminder ? fmtDateTime(c.nextReminder) : '');
    setLastContacted(c.lastContacted ? fmtDateTime(c.lastContacted) : '');
    setTags(c.tags.join(', ')); setSelectedFolder(c.folderId||'default');
    setBirthday(c.birthday ? fmtDateTime(c.birthday) : '');
    setRelationshipStrength(c.relationshipStrength || 'moderate');
    setFormOpen(true);
  };
  const cancelEdit = () => { setEditingContact(null); clearForm(); setFormOpen(false); };
  const deleteContact = (id: string) => { if (confirm('Delete this contact?')) { setContacts(contacts.filter(c => c.id !== id)); addToast('Contact deleted.', 'success'); } };

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.role.toLowerCase().includes(search.toLowerCase()) ||
    (c.email||'').toLowerCase().includes(search.toLowerCase()) ||
    c.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  // Smart suggestions: last contacted > 14 days ago
  const suggestions = useMemo(() => {
    return contacts.filter(c => {
      const days = daysSince(c.lastContacted);
      return days !== null && days >= 14;
    }).sort((a, b) => (daysSince(a.lastContacted) ?? 0) - (daysSince(b.lastContacted) ?? 0));
  }, [contacts]);

  // Upcoming birthdays (within 30 days)
  const upcomingBirthdays = useMemo(() => {
    const today = new Date();
    return contacts.filter(c => {
      if (!c.birthday) return false;
      const bday = new Date(c.birthday);
      const thisYear = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
      const diff = Math.ceil((thisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return diff >= 0 && diff <= 30;
    });
  }, [contacts]);

  const dueNow = contacts.filter(c => c.nextReminder && isOverdue(c.nextReminder)).length;

  const createGroup = () => {
    if (!groupName.trim()) return;
    const g: StudyGroup = { id: Date.now().toString(), name: groupName.trim(), memberIds: [], createdBy: '', createdAt: new Date(), color: '#FF5136' };
    setGroups([...groups, g]);
    setGroupName('');
    addToast('Study group created!', 'success');
  };

  const addToGroup = (groupId: string, contactId: string) => {
    setGroups(groups.map(g => g.id === groupId ? { ...g, memberIds: [...g.memberIds, contactId] } : g));
    setContacts(contacts.map(c => c.id === contactId ? { ...c, studyGroupIds: [...(c.studyGroupIds || []), groupId] } : c));
    addToast('Added to group!', 'success');
  };

  const removeFromGroup = (groupId: string, contactId: string) => {
    setGroups(groups.map(g => g.id === groupId ? { ...g, memberIds: g.memberIds.filter(id => id !== contactId) } : g));
    setContacts(contacts.map(c => c.id === contactId ? { ...c, studyGroupIds: (c.studyGroupIds || []).filter(id => id !== groupId) } : c));
  };

  const sendGroupMessage = () => {
    if (!activeGroup || !groupMessage.trim()) return;
    const members = contacts.filter(c => activeGroup.memberIds.includes(c.id));
    const emails = members.filter(c => c.email).map(c => c.email);
    addToast(`Message sent to ${emails.length} member(s): "${groupMessage}"`, 'success');
    setGroupMessage('');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>People & Reminders</h2>
          {dueNow > 0 && <p className="text-sm" style={{ color: 'var(--danger)', marginTop: '0.2rem' }}>⏰ {dueNow} reminder{dueNow > 1 ? 's' : ''} overdue</p>}
          {upcomingBirthdays.length > 0 && <p className="text-sm" style={{ color: 'var(--accent)', marginTop: '0.2rem' }}>🎂 {upcomingBirthdays.length} upcoming birthday(s) this month</p>}
        </div>
        <button className="btn btn-primary" onClick={() => { if (!editingContact) setFormOpen(o => !o); }}>
          {formOpen ? '✕ Close' : '+ New Person'}
        </button>
      </div>

      {tier === 'free' && totalItems >= 40 && (
        <div className="limit-warning">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <p>Approaching your 50 item limit!</p>
          <button className="btn btn-secondary btn-sm" onClick={() => setCurrentView('pricing')}>Upgrade</button>
        </div>
      )}

      {(formOpen || editingContact) && (
        <div className="card animate-in" style={{ marginBottom: '1.75rem' }}>
          <div className="card-header">
            <span className="card-title">{editingContact ? '✏️ Edit Person' : '✚ New Person'}</span>
            {tier === 'free' && <span className="tag accent">{totalItems}/50 items</span>}
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <input type="text" className="input" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} required />
              <input type="text" className="input" placeholder="Role (Professor, Classmate, Client…)" value={role} onChange={e => setRole(e.target.value)} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <input type="email" className="input" placeholder="Email (optional)" value={email} onChange={e => setEmail(e.target.value)} />
              <input type="tel" className="input" placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <select className="select" value={selectedFolder} onChange={e => setSelectedFolder(e.target.value)}>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {tier === 'pro' && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" className="input" placeholder="New folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addFolder}>+ Folder</button>
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.25rem' }}>Birthday</label>
                <input type="date" className="input" value={birthday} onChange={e => setBirthday(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.25rem' }}>Relationship strength</label>
                <select className="select" value={relationshipStrength} onChange={e => setRelationshipStrength(e.target.value as any)}>
                  <option value="weak">Weak</option>
                  <option value="moderate">Moderate</option>
                  <option value="strong">Strong</option>
                </select>
              </div>
            </div>
            <textarea className="textarea" placeholder="Notes about this person…" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.25rem' }}>Follow-up reminder</label>
                <input type="datetime-local" className="input" value={nextReminder} onChange={e => setNextReminder(e.target.value)} />
              </div>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.25rem' }}>Last contacted</label>
                <input type="datetime-local" className="input" value={lastContacted} onChange={e => setLastContacted(e.target.value)} />
              </div>
            </div>
            <input type="text" className="input" placeholder="Tags (comma separated)" value={tags} onChange={e => setTags(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="submit" className="btn btn-primary" disabled={!editingContact && tier === 'free' && totalItems >= 50}>{!editingContact && tier === 'free' && totalItems >= 50 ? 'Upgrade to Add More' : editingContact ? 'Update Contact' : 'Save Contact'}</button>
              {editingContact && <button type="button" className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </div>
      )}

      {/* Smart suggestions */}
      {suggestions.length > 0 && (
        <div className="card animate-in" style={{ marginBottom: '1.25rem', borderLeft: '3px solid var(--accent)' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>💡 Suggested to contact</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {suggestions.slice(0, 5).map(c => {
              const days = daysSince(c.lastContacted);
              const initials = c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-ink)', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span className="text-xs text-muted" style={{ marginLeft: '0.5rem' }}>{days} days ago</span>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setContacts(contacts.map(x => x.id === c.id ? { ...x, lastContacted: new Date() } : x)); addToast(`Marked ${c.name} as contacted`, 'success'); }}>✓ Contacted</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming birthdays */}
      {upcomingBirthdays.length > 0 && (
        <div className="card animate-in" style={{ marginBottom: '1.25rem', borderLeft: '3px solid #f472b6' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>🎂 Upcoming birthdays</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {upcomingBirthdays.map(c => {
              const bday = new Date(c.birthday!);
              const thisYear = new Date(new Date().getFullYear(), bday.getMonth(), bday.getDate());
              const diff = Math.ceil((thisYear.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>🎂</span>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span className="text-xs text-muted">in {diff} day{diff !== 1 ? 's' : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Study groups */}
      <div className="card animate-in" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginBottom: '0.75rem' }}>📚 Study Groups</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <input className="input" placeholder="New group name" value={groupName} onChange={e => setGroupName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <button className="btn btn-primary btn-sm" onClick={createGroup}>+ Create</button>
        </div>
        {groups.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {groups.map(g => (
              <div key={g.id} style={{ padding: '0.75rem', background: 'var(--surface-1)', borderRadius: 'var(--radius)', cursor: 'pointer' }} onClick={() => setActiveGroup(activeGroup?.id === g.id ? null : g)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: g.color }} />
                    <span style={{ fontWeight: 600 }}>{g.name}</span>
                    <span className="text-xs text-muted">{g.memberIds.length} members</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>{activeGroup?.id === g.id ? '▼' : '▶'}</span>
                </div>
                {activeGroup?.id === g.id && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {contacts.filter(c => g.memberIds.includes(c.id)).map(c => (
                        <span key={c.id} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          {c.name}
                          <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); removeFromGroup(g.id, c.id); }}>×</button>
                        </span>
                      ))}
                      {g.memberIds.length === 0 && <span className="text-xs text-muted">No members yet</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {contacts.filter(c => !g.memberIds.includes(c.id)).slice(0, 8).map(c => (
                        <button key={c.id} className="btn btn-secondary btn-xs" onClick={(e) => { e.stopPropagation(); addToGroup(g.id, c.id); }}>+ {c.name}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <input className="input" placeholder="Message all members..." value={groupMessage} onChange={e => setGroupMessage(e.target.value)} style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && sendGroupMessage()} />
                      <button className="btn btn-primary btn-sm" onClick={sendGroupMessage}>Send</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No study groups yet. Create one above to start collaborating.</p>
        )}
      </div>

      <div className="toolbar" style={{ marginBottom: '1.25rem' }}>
        <input type="text" className="input" placeholder="Search people by name, role, tags…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-secondary btn-sm" onClick={() => { setBulkMode(m => !m); setBulkSelected(new Set()); }}>
          {bulkMode ? '✕ Cancel' : '☑ Select'}
        </button>
        {bulkMode && bulkSelected.size > 0 && (
          <>
            <button className="btn btn-danger btn-sm" onClick={bulkDelete}>🗑️ Delete {bulkSelected.size}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setBulkTag('')}>🏷️ Tag</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setBulkFolder('')}>📁 Move</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setBulkReminder('')}>⏰ Remind</button>
          </>
        )}
      </div>

      {/* Bulk action panels */}
      {bulkMode && bulkTag && (
        <div className="card animate-in" style={{ marginBottom: '1rem', padding: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input className="input" placeholder="Tag to add" value={bulkTag} onChange={e => setBulkTag(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={bulkTagApply}>Apply</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setBulkTag('')}>Cancel</button>
          </div>
        </div>
      )}
      {bulkMode && bulkFolder && (
        <div className="card animate-in" style={{ marginBottom: '1rem', padding: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select className="select" value={bulkFolder} onChange={e => setBulkFolder(e.target.value)}>
              <option value="">Select folder</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={bulkFolderApply}>Move</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setBulkFolder('')}>Cancel</button>
          </div>
        </div>
      )}
      {bulkMode && bulkReminder && (
        <div className="card animate-in" style={{ marginBottom: '1rem', padding: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="datetime-local" className="input" value={bulkReminder} onChange={e => setBulkReminder(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={bulkReminderApply}>Set</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setBulkReminder('')}>Cancel</button>
          </div>
        </div>
      )}

      <div className="grid">
        {filtered.map(contact => {
          const overdue = contact.nextReminder && isOverdue(contact.nextReminder);
          const isSelected = bulkSelected.has(contact.id);
          const days = daysSince(contact.lastContacted);
          const strength = contact.relationshipStrength || getStrength(days);
          const initials = contact.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
          return (
            <div
              key={contact.id}
              className="card animate-in"
              style={{
                borderLeft: isSelected ? '3px solid var(--accent)' : overdue ? '3px solid var(--danger)' : undefined,
                background: isSelected ? 'var(--accent-soft)' : undefined,
                cursor: bulkMode ? 'pointer' : undefined,
              }}
              onClick={bulkMode ? () => toggleBulkSelect(contact.id) : undefined}
            >
              {bulkMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`, background: isSelected ? 'var(--accent)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: '0.7rem', lineHeight: 1 }}>✓</span>}
                  </div>
                  <span className="text-xs text-muted">{isSelected ? 'Selected' : 'Click to select'}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-ink)', fontWeight: 700, fontSize: '1rem', flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div>
                    <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>{contact.name}</h3>
                    <p className="text-sm text-muted">{contact.role}</p>
                  </div>
                </div>
                {!bulkMode && (
                  <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0, alignItems: 'center' }}>
                    <span className="tag" style={{ background: strengthColor(strength), color: '#fff', fontSize: '0.7rem' }}>{strength}</span>
                    <button className="btn btn-ghost btn-xs" onClick={() => startEdit(contact)}>✏️</button>
                    <button className="btn btn-danger btn-xs" onClick={() => deleteContact(contact.id)}>🗑️</button>
                  </div>
                )}
              </div>

              {contact.folderId && contact.folderId !== 'default' && (
                <span className="tag" style={{ marginBottom: '0.5rem', display: 'inline-flex' }}>📁 {folders.find(f => f.id === contact.folderId)?.name}</span>
              )}

              {contact.birthday && (
                <div style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.6rem', borderRadius: 'var(--radius)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', fontSize: '0.8rem', color: 'var(--accent)' }}>
                  🎂 {new Date(contact.birthday).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.5rem' }}>
                {contact.email && <p className="text-sm"><span style={{ marginRight: '0.375rem' }}>📧</span><a href={`mailto:${contact.email}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{contact.email}</a></p>}
                {contact.phone && <p className="text-sm"><span style={{ marginRight: '0.375rem' }}>📱</span>{contact.phone}</p>}
                {contact.lastContacted && <p className="text-sm text-muted"><span style={{ marginRight: '0.375rem' }}>🕐</span>Last contacted: {new Date(contact.lastContacted).toLocaleDateString()} {days !== null ? `(${days}d)` : ''}</p>}
                {contact.notes && <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>{contact.notes}</p>}
              </div>

              {contact.nextReminder && (
                <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', background: overdue ? 'var(--danger-soft)' : 'var(--surface-2)', border: `1px solid ${overdue ? 'var(--danger)' : 'var(--border)'}` }}>
                  <span>{overdue ? '🔴' : '⏰'}</span>
                  <p className="text-sm" style={{ fontWeight: 600, color: overdue ? 'var(--danger)' : 'var(--text-2)' }}>
                    {overdue ? 'Overdue: ' : 'Reminder: '}{new Date(contact.nextReminder).toLocaleString()}
                  </p>
                </div>
              )}

              {contact.tags.length > 0 && (
                <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {contact.tags.map(t => <span key={t} className="tag">{t}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">{search ? '🔍' : '👥'}</div>
          <h3>{search ? 'No results found' : 'No contacts yet'}</h3>
          <p>{search ? 'Try a different search.' : 'Add your first person with "+ New Person".'}</p>
        </div>
      )}
    </div>
  );
}
