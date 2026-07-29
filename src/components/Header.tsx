import { useState } from 'react';

interface HeaderProps {
  currentTab: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenMenu?: () => void;
}

const TABS: Record<string, string> = {
  dashboard: 'Dashboard',
  notes: 'Notes',
  contacts: 'People',
  flashcards: 'Flashcards',
  pricing: 'Pricing',
  multiplayer: 'Quiz Battle',
  settings: 'Settings',
};

export function Header({ currentTab, searchQuery, onSearchChange, onOpenMenu }: HeaderProps) {
  const [_u] = useState(0);
  const title = TABS[currentTab] || 'StudyWorks';

  return (
    <header className="sticky top-0 z-20 bg-[#111115]/80 backdrop-blur border-b border-[#2A2A2E] px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {onOpenMenu && (
            <button
              onClick={onOpenMenu}
              className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-[#16161A] text-zinc-300"
              aria-label="Open menu"
            >
              ☰
            </button>
          )}
          <h1 className="text-base sm:text-lg font-bold text-white truncate heading-font tracking-wide">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <label className="relative">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search…"
              className="w-40 sm:w-56 rounded-xl bg-[#16161A] border border-[#2A2A2E] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-[#2DD4BF]/50 focus:ring-1 focus:ring-[#2DD4BF]/20"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs pointer-events-none">
              ⌘K
            </span>
          </label>
        </div>
      </div>
    </header>
  );
}
