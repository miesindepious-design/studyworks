/**
 * nav.ts — the app's navigation model.
 *
 * The sidebar renders `NAV_GROUPS`; `NAV_ITEMS` remains a flat list for
 * anything that needs to look a view up by id (command palette, shortcuts,
 * deep links).
 */
import type { ComponentType } from 'react';
import {
  IconDashboard, IconNotes, IconPeople, IconCards, IconTimer,
  IconTutor, IconStudyRoom, IconQuiz, IconPricing, IconSettings,
  type IconProps,
} from '../components/icons';

export type View =
  | 'dashboard' | 'notes' | 'contacts' | 'flashcards' | 'pricing' | 'settings'
  | 'multiplayer' | 'studyRoom' | 'tutor' | 'timer' | 'admin';

export interface NavItem {
  view: View;
  label: string;
  icon: ComponentType<IconProps>;
  /** Shows a live count next to the label (e.g. notes count). */
  count?: number;
  /** Draws attention with the accent colour even when inactive. */
  highlight?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Study',
    items: [
      { view: 'dashboard',   label: 'Dashboard',   icon: IconDashboard },
      { view: 'notes',       label: 'Notes',       icon: IconNotes },
      { view: 'contacts',    label: 'People',      icon: IconPeople },
      { view: 'flashcards',  label: 'Flashcards',  icon: IconCards },
      { view: 'timer',       label: 'Timer',       icon: IconTimer },
    ],
  },
  {
    label: 'Create',
    items: [
      { view: 'tutor',       label: 'AI Tutor',    icon: IconTutor },
      { view: 'studyRoom',   label: 'Study Room',  icon: IconStudyRoom },
      { view: 'multiplayer', label: 'Quiz Battle', icon: IconQuiz },
    ],
  },
  {
    label: 'Account',
    items: [
      { view: 'pricing',     label: 'Pricing',     icon: IconPricing },
      { view: 'settings',    label: 'Settings',    icon: IconSettings },
    ],
  },
];

/** Flat list of every navigable view (admin excluded — it is contextual). */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

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
