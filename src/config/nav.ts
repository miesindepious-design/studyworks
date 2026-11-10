/**
 * Shared navigation config.
 *
 * Used by the sidebar (App.tsx) and the scroll-reveal corner dock
 * (CornerDock.tsx) so both stay in sync when a section is added.
 */
export type View =
  | 'dashboard' | 'notes' | 'contacts' | 'flashcards' | 'pricing' | 'settings'
  | 'multiplayer' | 'studyRoom' | 'tutor' | 'timer' | 'admin';

export const NAV_ITEMS: { view: View; icon: string; label: string }[] = [
  { view: 'dashboard',   icon: '⊞',  label: 'Dashboard'  },
  { view: 'notes',       icon: '📝', label: 'Notes'       },
  { view: 'contacts',    icon: '👥', label: 'People'      },
  { view: 'flashcards',  icon: '💡', label: 'Flashcards'  },
  { view: 'pricing',     icon: '💎', label: 'Pricing'     },
  { view: 'tutor',       icon: '🎓', label: 'AI Tutor'    },
  { view: 'studyRoom',   icon: '📹', label: 'Study Room'  },
  { view: 'multiplayer', icon: '🎮', label: 'Quiz Battle' },
  { view: 'timer',       icon: '⏱️', label: 'Timer'       },
  { view: 'settings',    icon: '⚙️', label: 'Settings'    },
];

export const PAGE_TITLES: Record<View, string> = {
  dashboard:   'Dashboard',
  notes:       'Notes & Knowledge Base',
  contacts:    'People & Reminders',
  flashcards:  'Flashcards',
  pricing:     'Pricing',
  tutor:       'AI Tutor',
  multiplayer: 'Quiz Battle',
  studyRoom:   'Study Room',
  timer:       'Study Timer',
  settings:    'Settings',
  admin:       'Admin Dashboard',
};

/**
 * Tabs that live in the scroll-reveal corner dock. Marketing (pricing) and
 * the admin console stay in the sidebar — they are not scroll-time jumps.
 */
export const DOCK_ITEMS: { view: View; icon: string; label: string }[] = [
  { view: 'dashboard',   icon: '⊞',  label: 'Home'      },
  { view: 'notes',       icon: '📝', label: 'Notes'     },
  { view: 'contacts',    icon: '👥', label: 'People'    },
  { view: 'flashcards',  icon: '💡', label: 'Cards'     },
  { view: 'tutor',       icon: '🎓', label: 'Tutor'     },
  { view: 'studyRoom',   icon: '📹', label: 'Study Room'},
  { view: 'multiplayer', icon: '🎮', label: 'Battle'    },
  { view: 'timer',       icon: '⏱️', label: 'Timer'     },
  { view: 'settings',    icon: '⚙️', label: 'Settings'  },
];
