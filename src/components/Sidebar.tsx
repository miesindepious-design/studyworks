import { useState } from 'react';
import type { TabType } from '../types';

interface SidebarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  flashcardsCount?: number;
}

const NAV_ITEMS: { id: string; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⊞' },
  { id: 'notes', label: 'Notes', icon: '📝' },
  { id: 'people', label: 'People', icon: '👥' },
  { id: 'flashcards', label: 'Flashcards', icon: '💡' },
  { id: 'pricing', label: 'Pricing', icon: '💎' },
  { id: 'quiz', label: 'Quiz Battle', icon: '⚔️' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export function Sidebar({ currentTab, onSelectTab, flashcardsCount = 0 }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSelect = (id: string) => {
    onSelectTab(id as TabType);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {/* Desktop */}
      <aside
        className="hidden lg:flex flex-col w-64 h-screen sticky top-0 z-30 bg-[#111115] border-r border-[#2A2A2E] select-none shrink-0"
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="p-5 border-b border-[#2A2A2E]/60 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#2DD4BF]/10 border border-[#2DD4BF]/30 flex items-center justify-center text-[#2DD4BF] font-bold tracking-tight">
            SW
          </div>
          <div className="leading-none">
            <div className="font-extrabold text-base tracking-wider text-white uppercase heading-font">
              StudyWorks
            </div>
            <div className="text-[10px] text-zinc-500 tracking-wider mono-font uppercase mt-0.5">
              Workspace v2
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          <p className="px-3 py-1.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mono-font">
            Menu
          </p>
          {NAV_ITEMS.map((item) => {
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  active
                    ? 'bg-[#1D1D24] text-white border border-[#2A2A2E] shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-[#16161A]'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`text-base transition-colors ${
                      active ? 'text-[#2DD4BF]' : 'text-zinc-400 group-hover:text-zinc-200'
                    }`}
                    aria-hidden
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </span>
                {item.id === 'flashcards' && flashcardsCount > 0 && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full mono-font ${
                      active ? 'bg-[#2DD4BF]/20 text-[#2DD4BF]' : 'bg-[#2A2A2E] text-zinc-400'
                    }`}
                  >
                    {flashcardsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-[#2A2A2E]/60 bg-[#0C0C0E]/50 space-y-3">
          <div className="px-3 py-2 rounded-xl bg-gradient-to-r from-[#2DD4BF]/10 to-emerald-500/5 border border-[#2DD4BF]/20 text-xs">
            <span className="text-[#2DD4BF] font-semibold">Pro Plan Active</span>
            <span className="text-[10px] text-zinc-400 mono-font ml-2">UNLIMITED</span>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-40 bg-[#111115] border-b border-[#2A2A2E] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#2DD4BF]/10 border border-[#2DD4BF]/30 flex items-center justify-center text-[#2DD4BF] font-bold text-sm">
            SW
          </div>
          <span className="font-extrabold text-white heading-font uppercase text-sm tracking-wider">
            StudyWorks
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-xl bg-[#16161A] border border-[#2A2A2E] text-zinc-300"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-[#0C0C0E]/95 pt-16 p-6 space-y-2 animate-fade-in"
          role="dialog"
          aria-label="Mobile navigation"
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelect(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold ${
                currentTab === item.id
                  ? 'bg-[#2DD4BF] text-black'
                  : 'text-zinc-300 bg-[#16161A]'
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
