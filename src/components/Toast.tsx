import { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

const CONFIG = {
  success: { icon: '✅', bg: 'linear-gradient(135deg,#10b981,#059669)' },
  error:   { icon: '❌', bg: 'linear-gradient(135deg,#ef4444,#dc2626)' },
  info:    { icon: 'ℹ️',  bg: 'linear-gradient(135deg,#4F8CFF,#FFC531)' },
};

export default function Toast({ message, type, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // trigger entrance
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 250);
    }, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  const { icon, bg } = CONFIG[type];

  return (
    <div style={{
      background: bg,
      color: '#fff',
      padding: '0.75rem 1.125rem',
      borderRadius: '0.625rem',
      boxShadow: '0 8px 24px rgb(0 0 0 / .25)',
      display: 'flex',
      alignItems: 'center',
      gap: '0.625rem',
      fontSize: '0.875rem',
      fontWeight: 500,
      maxWidth: '340px',
      opacity: visible ? 1 : 0,
      transform: visible ? 'none' : 'translateX(24px)',
      transition: 'opacity 200ms ease, transform 200ms ease',
      cursor: 'pointer',
    }} onClick={() => { setVisible(false); setTimeout(onClose, 200); }}>
      <span style={{ fontSize: '1rem' }}>{icon}</span>
      <span style={{ flex: 1 }}>{message}</span>
      <span style={{ opacity: 0.7, fontSize: '0.75rem', marginLeft: '0.25rem' }}>✕</span>
    </div>
  );
}
