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
  IconTutor, IconStudyRoom, IconQuiz, IconLobby, IconPricing, IconSettings,
  IconTrophy, IconDuel, IconTarget,
  type IconProps,
} from '../components/icons';

export type View =
  | 'dashboard' | 'notes' | 'contacts' | 'flashcards' | 'pricing' | 'settings'
  | 'multiplayer' | 'studyRoom' | 'tutor' | 'timer' | 'admin' | 'lobby'
  | 'leaderboard' | 'duel' | 'plan';

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
      { view: 'plan',        label: 'Study Plan',  icon: IconTarget },
      { view: 'notes',       label: 'Notes',       icon: IconNotes },
      { view: 'contacts',    label: 'People',      icon: IconPeople },
      { view: 'flashcards',  label: 'Flashcards',  icon: IconCards },
      { view: 'timer',       label: 'Timer',       icon: IconTimer },
      { view: 'leaderboard', label: 'Leaderboard', icon: IconTrophy },
    ],
  },
  {
    label: 'Create',
    items: [
      { view: 'tutor',       label: 'AI Tutor',    icon: IconTutor },
      { view: 'lobby',       label: 'Lobby',       icon: IconLobby },
      { view: 'studyRoom',   label: 'Study Room',  icon: IconStudyRoom },
      { view: 'multiplayer', label: 'Quiz Battle', icon: IconQuiz },
      { view: 'duel',        label: 'Duels',       icon: IconDuel },
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
  plan:        'Study Plan',
  notes:       'Notes & Knowledge Base',
  contacts:    'People & Reminders',
  flashcards:  'Flashcards',
  pricing:     'Pricing',
  tutor:       'AI Tutor',
  multiplayer: 'Quiz Battle',
  studyRoom:   'Study Room',
  lobby:       'Lobby',
  timer:       'Study Timer',
  leaderboard: 'Leaderboard',
  duel:        'Duels',
  settings:    'Settings',
  admin:       'Admin Dashboard',
};
