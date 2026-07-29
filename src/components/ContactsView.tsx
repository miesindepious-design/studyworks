import { useState } from 'react';
import { Contact, Folder } from '../types';

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

  const clearForm = () => { setName(''); setRole(''); setEmail(''); setPhone(''); setNotes(''); setNextReminder(''); setLastContacted(''); setTags(''); };

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
        nextReminder:  nextReminder  ? new Date(nextReminder)  : undefined,
        lastContacted: lastContacted ? new Date(lastContacted) : c.lastContacted,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        folderId: selectedFolder,
      } : c));
      setEditingContact(null); setFormOpen(false); clearForm(); addToast('Contact updated!', 'success');
    } else {
      if (tier === 'free' && totalItems >= 50) { addToast('50 item limit reached. Upgrade to Pro.', 'info'); setCurrentView('pricing'); return; }
      setContacts([{
        id: Date.now().toString(), name, role,
        email: email || undefined,
        phone: phone || undefined,
        notes: notes || undefined,
        nextReminder:  nextReminder  ? new Date(nextReminder)  : undefined,
        lastContacted: lastContacted ? new Date(lastContacted) : undefined,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        folderId: selectedFolder,
      }, ...contacts]);
      clearForm(); setFormOpen(false); addToast('Contact added!', 'success');
    }
  };

  const startEdit = (c: Contact) => { setEditingContact(c); setName(c.name); setRole(c.role); setEmail(c.email||''); setPhone(c.phone||''); setNotes(c.notes||''); setNextReminder(c.nextReminder ? fmtDateTime(c.nextReminder) : ''); setLastContacted(c.lastContacted ? fmtDateTime(c.lastContacted) : ''); setTags(c.tags.join(', ')); setSelectedFolder(c.folderId||'default'); setFormOpen(true); };
  const cancelEdit = () => { setEditingContact(null); clearForm(); setFormOpen(false); };
  const deleteContact = (id: string) => { if (confirm('Delete this contact?')) { setContacts(contacts.filter(c => c.id !== id)); addToast('Contact deleted.', 'success'); } };

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.role.toLowerCase().includes(search.toLowerCase()) ||
    (c.email||'').toLowerCase().includes(search.toLowerCase()) ||
    c.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  const dueNow = contacts.filter(c => c.nextReminder && isOverdue(c.nextReminder)).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>People &amp; Reminders</h2>
          {dueNow > 0 && <p className="text-sm" style={{ color: 'var(--danger)', marginTop: '0.2rem' }}>⏰ {dueNow} reminder{dueNow > 1 ? 's' : ''} overdue</p>}
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

      <div className="toolbar" style={{ marginBottom: '1.25rem' }}>
        <input type="text" className="input" placeholder="Search people by name, role, tags…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-secondary btn-sm" onClick={() => { setBulkMode(m => !m); setBulkSelected(new Set()); }}>
          {bulkMode ? '✕ Cancel' : '☑ Select'}
        </button>
        {bulkMode && bulkSelected.size > 0 && (
          <button className="btn btn-danger btn-sm" onClick={bulkDelete}>🗑️ Delete {bulkSelected.size}</button>
        )}
      </div>

      <div className="grid">
        {filtered.map(contact => {
          const overdue = contact.nextReminder && isOverdue(contact.nextReminder);
          const isSelected = bulkSelected.has(contact.id);
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
              {/* Bulk checkbox */}
              {bulkMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`, background: isSelected ? 'var(--accent)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: '0.7rem', lineHeight: 1 }}>✓</span>}
                  </div>
                  <span className="text-xs text-muted">{isSelected ? 'Selected' : 'Click to select'}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-ink)', fontWeight: 700, fontSize: '1rem', flexShrink: 0 }}>
                      {contact.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>{contact.name}</h3>
                      <p className="text-sm text-muted">{contact.role}</p>
                    </div>
                  </div>
                </div>
                {!bulkMode && (
                  <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => startEdit(contact)}>✏️</button>
                    <button className="btn btn-danger btn-xs" onClick={() => deleteContact(contact.id)}>🗑️</button>
                  </div>
                )}
              </div>

              {contact.folderId && contact.folderId !== 'default' && (
                <span className="tag" style={{ marginBottom: '0.5rem', display: 'inline-flex' }}>📁 {folders.find(f => f.id === contact.folderId)?.name}</span>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.5rem' }}>
                {contact.email && <p className="text-sm"><span style={{ marginRight: '0.375rem' }}>📧</span><a href={`mailto:${contact.email}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{contact.email}</a></p>}
                {contact.phone && <p className="text-sm"><span style={{ marginRight: '0.375rem' }}>📱</span>{contact.phone}</p>}
                {contact.lastContacted && <p className="text-sm text-muted"><span style={{ marginRight: '0.375rem' }}>🕐</span>Last contacted: {new Date(contact.lastContacted).toLocaleDateString()}</p>}
                {contact.notes && <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>{contact.notes}</p>}
              </div>

              {contact.nextReminder && (
                <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', background: overdue ? '#fff1f2' : 'var(--surface-2)', border: `1px solid ${overdue ? 'var(--danger)' : 'var(--border)'}` }}>
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
