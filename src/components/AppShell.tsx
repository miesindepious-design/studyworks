/**
 * AppShell — the persistent frame around every page.
 *
 * Sidebar  : grouped navigation (Study / Create / Account), plan card, account
 * Topbar   : page title, workspace search, notifications, accent swatches
 *
 * Both are driven by `config/nav.ts` so adding a view is a one-line change.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { NAV_GROUPS, PAGE_TITLES, type View } from '../config/nav';
import { ACCENT_THEMES } from '../config/accents';
import {
  IconSearch, IconBell, IconCrown, IconChevronRight, IconLogout,
  IconShield, IconDashboard,
} from './icons';
import ProfilePopover from './ProfilePopover';
import type { AuthUser } from '../api/auth';

interface AppShellProps {
  currentView: View;
  onNavigate: (view: View) => void;
  pageTitle?: string;
  userName: string;
  userEmail?: string;
  userSub?: string;
  tier: 'free' | 'pro';
  trialDaysLeft: number;
  totalItems: number;
  notesCount: number;
  dueFlashcards: number;
  accentId: string;
  onAccentChange: (id: string) => void;
  onOpenCommandPalette: () => void;
  onOpenPricing: () => void;
  onSignOut: () => void;
  isAdmin?: boolean;
  /** Signed-in user record — enables the profile popover on avatar click. */
  profileUser?: AuthUser | null;
  /** Label shown in the profile card ("Free plan" / "Pro plan"). */
  tierLabel?: string;
  /** Called after the user saves their profile (new name/image). */
  onProfileSaved?: (user: AuthUser) => void;
  /** Toast sink for profile edit feedback. */
  addToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  /** Extra controls rendered at the end of the topbar action row. */
  topbarExtra?: ReactNode;
  /** Extra controls rendered at the bottom of the sidebar. */
  sidebarExtra?: ReactNode;
  children: ReactNode;
}

export default function AppShell(props: AppShellProps) {
  const {
    currentView, onNavigate, userName, userEmail, userSub, tier, trialDaysLeft,
    totalItems, notesCount, dueFlashcards, accentId, onAccentChange,
    onOpenCommandPalette, onOpenPricing, onSignOut, isAdmin,
    profileUser, tierLabel, onProfileSaved, addToast,
    topbarExtra, sidebarExtra, children,
  } = props;

  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const go = (view: View) => {
    onNavigate(view);
    setMenuOpen(false);
  };

  const initials = (userName || 'A').trim().charAt(0).toUpperCase();

  return (
    <div className="sw-shell">
      {menuOpen && (
        <div className="sw-scrim show" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`sw-sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sw-brand">
          <div className="sw-brand-mark">
            <IconDashboard size={17} strokeWidth={2} />
          </div>
          <span className="sw-brand-name">StudyWorks</span>
        </div>

        <p className="sw-eyebrow">Your space to grow</p>

        <nav className="sw-nav" aria-label="Main">
          {NAV_GROUPS.map(group => (
            <div className="sw-nav-group" key={group.label}>
              <p className="sw-nav-label">{group.label}</p>
              {group.items.map(item => {
                const Icon = item.icon;
                const active = currentView === item.view;
                const count =
                  item.view === 'notes' ? notesCount :
                  item.view === 'flashcards' && dueFlashcards > 0 ? dueFlashcards :
                  undefined;
                return (
                  <button
                    key={item.view}
                    type="button"
                    className={`sw-nav-item${active ? ' active' : ''}`}
                    onClick={() => go(item.view)}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="sw-nav-icon"><Icon size={17} /></span>
                    <span className="sw-nav-label-text">{item.label}</span>
                    {count !== undefined && <span className="sw-nav-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          ))}

          {isAdmin && (
            <div className="sw-nav-group">
              <p className="sw-nav-label">Admin</p>
              <button
                type="button"
                className={`sw-nav-item${currentView === 'admin' ? ' active' : ''}`}
                onClick={() => go('admin')}
              >
                <span className="sw-nav-icon"><IconShield size={17} /></span>
                <span className="sw-nav-label-text">Admin</span>
              </button>
            </div>
          )}
        </nav>

        {/* ── Sidebar footer ────────────────────────────────────────────── */}
        <div className="sw-sidebar-foot">
          <div className="sw-pro-card">
            <span className="sw-pro-card-sheen" aria-hidden="true" />
            <div className="sw-pro-card-top">
              <span className="sw-pro-card-icon"><IconCrown size={12} strokeWidth={2} /></span>
              <span className="sw-pro-card-tier">
                {trialDaysLeft > 0 ? `Pro trial · ${trialDaysLeft}d left` : 'Pro plan'}
              </span>
              <span className="sw-pro-card-pip" aria-hidden="true" />
            </div>
            <p className="sw-pro-card-copy">
              {trialDaysLeft > 0
                ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left on your free Pro trial.`
                : 'Make room for your next big idea.'}
            </p>
            <button type="button" className="sw-pro-card-link" onClick={onOpenPricing}>
              Manage subscription <IconChevronRight size={11} strokeWidth={2.2} />
            </button>
          </div>

          {tier === 'free' && (
            <div style={{ padding: '0 8px' }}>
              <p style={{ fontSize: '0.6875rem', color: 'var(--sw-text-3)', marginBottom: 5 }}>
                {totalItems}/50 items used
              </p>
              <div className="sw-meter">
                <div
                  className="sw-meter-fill"
                  style={{ width: `${Math.min(100, (totalItems / 50) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {sidebarExtra}

          <div className="sw-account">
            {props.profileUser?.image
              ? <img src={props.profileUser.image} alt={initials} className="sw-account-avatar" style={{ objectFit: 'cover' }} />
              : <div className="sw-account-avatar">{initials}</div>}
            <div className="sw-account-text">
              <div className="sw-account-name">{userName}</div>
              <div className="sw-account-sub">{userSub || userEmail}</div>
            </div>
            <button
              type="button"
              className="sw-icon-btn"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              style={{ width: 28, height: 28 }}
            >
              <IconLogout size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main column ────────────────────────────────────────────────── */}
      <div className="sw-main">
        <header className="sw-topbar">
          <button
            type="button"
            className="sw-icon-btn hamburger"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            style={{ display: 'none' }}
          >
            ☰
          </button>

          <span className="sw-topbar-title">{props.pageTitle || PAGE_TITLES[currentView]}</span>
          <span className="sw-topbar-spacer" />

          <div className="sw-topbar-actions">
            <button
              type="button"
              className="sw-search"
              onClick={onOpenCommandPalette}
              aria-label="Search your workspace"
            >
              <IconSearch size={15} />
              <span className="sw-search-text">Search your workspace</span>
              <span className="sw-kbd">⌘K</span>
            </button>

            <button type="button" className="sw-icon-btn" title="Notifications" aria-label="Notifications">
              <IconBell size={17} />
              {dueFlashcards > 0 && <span className="sw-dot" />}
            </button>

            <div className="sw-swatches" role="group" aria-label="Accent colour">
              {ACCENT_THEMES.slice(0, 5).map(a => (
                <button
                  key={a.id}
                  type="button"
                  className={`sw-swatch${accentId === a.id ? ' active' : ''}`}
                  style={{ background: a.a, color: a.a }}
                  onClick={() => onAccentChange(a.id)}
                  title={a.label}
                  aria-label={`${a.label} accent`}
                />
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="sw-avatar"
                title={userName}
                aria-label="Account — open profile"
                aria-expanded={profileOpen}
                onClick={() => profileUser ? setProfileOpen(o => !o) : onSignOut()}
              >
                {profileUser?.image
                  ? <img src={profileUser.image} alt={initials} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  : initials}
              </button>
              {profileOpen && profileUser && (
                <ProfilePopover
                  user={profileUser}
                  tierLabel={tierLabel || (tier === 'pro' ? 'Pro plan' : 'Free plan')}
                  onClose={() => setProfileOpen(false)}
                  onSignOut={() => { setProfileOpen(false); onSignOut(); }}
                  onSaved={u => {
                    setProfileOpen(false);
                    onProfileSaved?.(u);
                  }}
                  addToast={addToast || (() => {})}
                />
              )}
            </div>

            {topbarExtra}
          </div>
        </header>

        <main className="sw-content">{children}</main>
      </div>
    </div>
  );
}
