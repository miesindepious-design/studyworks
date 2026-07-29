interface LoadingScreenProps {
  error?: boolean;
}

export default function LoadingScreen({ error = false }: LoadingScreenProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '1rem',
    }}>
      <span style={{ fontSize: '3rem' }}>📚</span>
      {error ? (
        <>
          <h2 style={{ fontWeight: 700, color: 'var(--danger)' }}>Failed to load database</h2>
          <p style={{ color: 'var(--text-2)', fontSize: '0.9rem', maxWidth: '320px', textAlign: 'center' }}>
            Your browser may not support IndexedDB, or storage permissions may be blocked. Try a different browser or check your privacy settings.
          </p>
        </>
      ) : (
        <>
          <h2 style={{ fontWeight: 700 }}>Loading StudyWorks…</h2>
          <div style={{
            width: '160px', height: '4px',
            background: 'var(--border)', borderRadius: 'var(--radius-full)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
              borderRadius: 'var(--radius-full)',
              animation: 'indeterminate 1.4s ease infinite',
            }} />
          </div>
          <style>{`
            @keyframes indeterminate {
              0%   { transform: translateX(-100%) scaleX(0.4); }
              40%  { transform: translateX(0%)    scaleX(0.6); }
              100% { transform: translateX(100%)  scaleX(0.4); }
            }
          `}</style>
        </>
      )}
    </div>
  );
}
