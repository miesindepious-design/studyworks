/**
 * PricingView — shows Free / Pro cards. Upgrade button now actually calls
 * Stripe Checkout via /api/stripe/checkout (server route already exists).
 * The earlier demo-only modal that flipped db.tier='pro' for free has been
 * removed; the only path to Pro is via Stripe.
 *
 * If Stripe isn't configured server-side (no STRIPE_PRO_*_PRICE_ID env),
 * the upgrade button is replaced with a friendly "Stripe not configured"
 * message so devs can still see the UI without env setup.
 */

import { useState, useEffect } from 'react';
import { getPriceIds, createCheckoutSession } from '../api/billing';

type Tier = 'free' | 'pro';
type Billing = 'monthly' | 'yearly';
type UserType = 'student' | 'regular';

interface PricingViewProps {
  currentTier: Tier;
  onDowngrade: () => void;          // free-tier downgrade is local-only
  onCheckoutResult: (result: 'success' | 'cancel') => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const FREE_FEATURES = [
  '50 items total (notes + contacts + flashcards)',
  '20 AI summaries / month',
  '1 personal note per item (200 chars)',
  '3 highlights per item',
  '1 default folder',
  'Basic text search',
  'JSON export',
  '100 MB browser storage',
  'Community support',
];

const FREE_MISSING = [
  'File uploads',
  'Browser extension',
  'Email-to-save',
];

const PRO_FEATURES = [
  { label: 'Unlimited items',                         built: true  },
  { label: 'Unlimited AI summaries & flashcards',     built: true  },
  { label: 'Unlimited personal notes (rich text)',    built: true  },
  { label: 'Unlimited highlights',                    built: true  },
  { label: 'Unlimited folders + smart folders',       built: true  },
  { label: 'File uploads — PDF, images, audio',       built: true  },
  { label: 'Auto-generate flashcards from notes',     built: true  },
  { label: 'Auto-generate practice questions',        built: true  },
  { label: 'Spaced repetition (SM-2 algorithm)',      built: true  },
  { label: 'Smart Q&A — "Ask your brain"',            built: true  },
  { label: 'Related notes auto-detection',            built: true  },
  { label: 'Saved searches',                          built: true  },
  { label: 'Semantic search (AI re-ranking)',         built: true  },
  { label: 'Custom AI prompts',                       built: true  },
  { label: 'Weekly AI study insights',                built: true  },
  { label: 'Note-to-note linking ([[Title]] syntax)', built: true  },
  { label: 'Export JSON + PDF',                       built: true  },
  { label: 'Bulk delete notes, cards & contacts',     built: true  },
  { label: 'Flashcard statistics dashboard',          built: true  },
  { label: 'Browser notifications + reminders',       built: true  },
  { label: 'Offline support (PWA)',                   built: true  },
  { label: 'Browser extension',                       built: false },
  { label: 'Email-to-save',                           built: false },
  { label: 'Save Twitter / YouTube',                  built: false },
  { label: 'Share folders with others',               built: false },
  { label: 'Cloud sync',                              built: false },
  { label: 'Email support (48 h)',                    built: false },
];

const ROADMAP = [
  {
    phase: 'Phase 1',
    subtitle: 'While in school · 0–6 months',
    color: 'var(--accent)',
    items: ['✅ All current features shipped', '🎯 Target: 50 paying users', '📈 ~$250 / mo MRR', '📣 Reddit, campus clubs, word of mouth'],
  },
  {
    phase: 'Phase 2',
    subtitle: 'Post-graduation · 6–24 months',
    color: 'var(--accent-2)',
    items: ['🚀 Browser extension', '📱 Mobile app (iOS & Android)', '🔗 Notion, Google Drive, Twitter integrations', '🎯 Target: 200–500 users', '📈 $1,600–6,000 MRR'],
  },
];

export default function PricingView({ currentTier, onDowngrade, onCheckoutResult, addToast }: PricingViewProps) {
  const [billing, setBilling]   = useState<Billing>('monthly');
  const [userType, setUserType] = useState<UserType>('student');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [stripePrices, setStripePrices] = useState<{ monthly: string; yearly: string } | null>(null);

  // Fetch Stripe price IDs once on mount. If empty, we render a "not configured" notice.
  useEffect(() => {
    getPriceIds()
      .then(setStripePrices)
      .catch(err => {
        console.warn('[Pricing] Failed to load Stripe prices:', err);
        setStripePrices({ monthly: '', yearly: '' });
      });
  }, []);

  const price = billing === 'monthly'
    ? (userType === 'student' ? '$4.99' : '$8.99')
    : '$29';
  const priceSub = billing === 'monthly' ? '/mo' : '/yr';

  const handleUpgrade = async () => {
    if (!stripePrices) {
      addToast('Loading payment options…', 'info');
      return;
    }
    const priceId = billing === 'monthly' ? stripePrices.monthly : stripePrices.yearly;
    if (!priceId) {
      addToast('Stripe is not configured. Set STRIPE_PRO_*_PRICE_ID in server .env.', 'error');
      return;
    }
    setCheckoutLoading(true);
    try {
      const url = await createCheckoutSession(priceId);
      window.location.href = url;
    } catch (err: any) {
      addToast(`Checkout failed: ${err.message}`, 'error');
      setCheckoutLoading(false);
    }
  };

  // `stripeConfigured` becomes true only when the server has at least one
  // price ID env var set. When the fetch hasn't completed yet, treat as
  // not-configured (the button will show a brief loading state).
  const stripeConfigured = stripePrices
    ? Boolean(stripePrices.monthly || stripePrices.yearly)
    : null;

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>Simple, honest pricing</h2>
        <p className="text-muted">Start free, upgrade when you're ready.</p>
      </div>

      {/* Billing toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'inline-flex', background: 'var(--surface-2)', borderRadius: 'var(--radius-lg)', padding: '4px', gap: '2px' }}>
          {(['monthly', 'yearly'] as const).map(b => (
            <button
              key={b}
              onClick={() => setBilling(b)}
              style={{
                padding: '0.4rem 1.25rem',
                borderRadius: 'var(--radius)',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'all var(--transition)',
                background: billing === b ? 'var(--surface)' : 'transparent',
                color: billing === b ? 'var(--text)' : 'var(--text-3)',
                boxShadow: billing === b ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {b === 'monthly' ? 'Monthly' : <>Yearly <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.75rem' }}>−52%</span></>}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', marginBottom: '3rem', alignItems: 'start' }}>

        {/* Free card */}
        <div className="card" style={{ border: currentTier === 'free' ? '2px solid var(--accent)' : '1px solid var(--border)' }}>
          {currentTier === 'free' && (
            <span className="tag primary" style={{ marginBottom: '0.75rem', display: 'inline-flex' }}>Current plan</span>
          )}
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.25rem' }}>Free</h3>
          <p className="text-sm text-muted" style={{ marginBottom: '1.25rem' }}>Experience the magic, with smart limits</p>

          <div style={{ marginBottom: '1.5rem' }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 900 }}>$0</span>
            <span className="text-muted"> / forever</span>
          </div>

          <p className="text-xs" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: '0.75rem' }}>What you get</p>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {FREE_FEATURES.map(f => (
              <li key={f} className="text-sm" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--success)', flexShrink: 0 }}>✓</span>{f}
              </li>
            ))}
          </ul>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {FREE_MISSING.map(f => (
              <li key={f} className="text-sm text-muted" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0 }}>✕</span>{f}
              </li>
            ))}
          </ul>

          {currentTier === 'free' ? (
            <button className="btn btn-secondary w-full" style={{ width: '100%' }} disabled>Current Plan</button>
          ) : (
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onDowngrade}>Downgrade to Free</button>
          )}
        </div>

        {/* Pro card */}
        <div className="card elevated" style={{ border: '2px solid var(--accent)', position: 'relative', overflow: 'visible' }}>
          {/* Recommended pill */}
          <div style={{ position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', color: '#fff', padding: '0.2rem 0.875rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
            ⭐ Recommended
          </div>
          {currentTier === 'pro' && (
            <span className="tag primary" style={{ marginBottom: '0.75rem', display: 'inline-flex' }}>Current plan</span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>💎 Pro</h3>
            {/* Student / Regular toggle */}
            <div style={{ display: 'inline-flex', background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '3px', gap: '2px' }}>
              {(['student', 'regular'] as const).map(u => (
                <button key={u} onClick={() => setUserType(u)} style={{ padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-sm)', border: 'none', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', background: userType === u ? 'var(--accent)' : 'transparent', color: userType === u ? '#fff' : 'var(--text-3)', transition: 'all var(--transition)' }}>
                  {u === 'student' ? '🎓 Student' : '💼 Regular'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '1.25rem' }}>Everything serious learners need to master their knowledge</p>

          <div style={{ marginBottom: billing === 'yearly' ? '0.25rem' : '1.5rem' }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 900 }}>{price}</span>
            <span className="text-muted">{priceSub}</span>
          </div>
          {billing === 'yearly' && <p style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.8125rem', marginBottom: '1.25rem' }}>🎉 Save 52% vs monthly!</p>}

          <p className="text-xs" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: '0.75rem' }}>Everything in Free, plus</p>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {PRO_FEATURES.filter(f => f.built).map(f => (
              <li key={f.label} className="text-sm" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--success)', flexShrink: 0 }}>✓</span>{f.label}
              </li>
            ))}
          </ul>
          <p className="text-xs" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: '0.625rem' }}>Coming soon</p>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {PRO_FEATURES.filter(f => !f.built).map(f => (
              <li key={f.label} className="text-sm text-muted" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0 }}>🔜</span>{f.label}
              </li>
            ))}
          </ul>

          {currentTier === 'pro' ? (
            <button className="btn btn-primary" style={{ width: '100%' }} disabled>Current Plan</button>
          ) : stripeConfigured === false ? (
            <>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled>Upgrade to Pro →</button>
              <p className="text-xs text-muted" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                Stripe is not configured. Set <code>STRIPE_PRO_MONTHLY_PRICE_ID</code> and
                <code>STRIPE_PRO_YEARLY_PRICE_ID</code> in <code>server/.env</code>.
              </p>
            </>
          ) : (
            <button
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              onClick={handleUpgrade}
              disabled={checkoutLoading || stripeConfigured === null}
            >
              {checkoutLoading ? 'Redirecting…' : stripeConfigured === null ? 'Loading…' : 'Upgrade to Pro →'}
            </button>
          )}
        </div>
      </div>

      {/* Checkout result (success/cancel) — only visible briefly after Stripe redirect */}
      <CheckoutResultHandler onResult={onCheckoutResult} />

      {/* Roadmap */}
      <div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1.5rem', textAlign: 'center' }}>🗺️ Roadmap</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {ROADMAP.map(r => (
            <div key={r.phase} className="card" style={{ borderTop: `3px solid ${r.color}` }}>
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontWeight: 800, color: r.color }}>{r.phase}</h3>
                <p className="text-sm text-muted">{r.subtitle}</p>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {r.items.map(item => <li key={item} className="text-sm">{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Watches the URL for ?checkout=success|cancel and invokes `onResult` once,
 * then strips the param from the URL so refreshes don't re-fire it.
 * The server's Stripe routes redirect here; the parent (App.tsx) uses the
 * signal to re-pull sync so the new tier from the webhook is reflected.
 */
function CheckoutResultHandler({ onResult }: { onResult: (r: 'success' | 'cancel') => void }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('checkout');
    if (result === 'success' || result === 'cancel') {
      onResult(result);
      // Clean the URL without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [onResult]);
  return null;
}
