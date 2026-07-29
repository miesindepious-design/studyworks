/**
 * SharedFolderView — public, read-only view of a shared folder.
 *
 * Rendered standalone (no auth, no app shell) when the URL is
 * /shared/:token. Fetches the public share payload and lists the notes.
 */
import { useEffect, useState } from 'react';
import { getPublicShare, type PublicShare } from '../api/phase2';

export default function SharedFolderView({ token }: { token: string }) {
  const [data, setData] = useState<PublicShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    getPublicShare(token)
      .then(setData)
      .catch((e: any) => setError(e?.message || 'This share link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <div style={wrap}><p style={{ color: '#888' }}>Loading shared folder…</p></div>;
  }
  if (error || !data) {
    return (
      <div style={wrap}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Share unavailable</h1>
          <p style={{ color: '#888' }}>{error}</p>
          <a href="/" style={linkBtn}>Go to StudyWorks →</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e7e9ee' }}>
      <header style={{ borderBottom: '1px solid #23262f', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#7c8299', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shared folder · read-only</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>📁 {data.folderName}</h1>
          <p style={{ color: '#7c8299', fontSize: '0.875rem' }}>{data.noteCount} note{data.noteCount === 1 ? '' : 's'}</p>
        </div>
        <a href="/" style={linkBtn}>StudyWorks</a>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '1.5rem' }}>
        {data.notes.length === 0 ? (
          <p style={{ color: '#7c8299', textAlign: 'center', marginTop: '3rem' }}>This folder is empty.</p>
        ) : data.notes.map(note => (
          <article key={note.id} style={card}>
            <button onClick={() => setOpenId(openId === note.id ? null : note.id)}
              style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>{note.title || 'Untitled'}</h2>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {note.tags.map(t => <span key={t} style={tag}>{t}</span>)}
              </div>
            </button>
            {openId === note.id && (
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #23262f', lineHeight: 1.7, fontSize: '0.9375rem' }}
                dangerouslySetInnerHTML={{ __html: note.content }} />
            )}
          </article>
        ))}
      </main>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1117', color: '#e7e9ee', padding: '1.5rem' };
const card: React.CSSProperties = { background: '#171a21', border: '1px solid #23262f', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '0.75rem' };
const tag: React.CSSProperties = { background: '#23262f', color: '#a9b1c6', fontSize: '0.75rem', padding: '0.1rem 0.5rem', borderRadius: 6 };
const linkBtn: React.CSSProperties = { display: 'inline-block', marginTop: '1rem', color: '#6ea8fe', textDecoration: 'none', fontWeight: 600 };
