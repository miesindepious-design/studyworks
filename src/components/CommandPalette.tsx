/**
 * CommandPalette — ⌘K / Ctrl+K launcher.
 *
 * Fuzzy-filtered list of navigation targets + quick actions. Keyboard-driven:
 * arrow keys to move, Enter to run, Esc to close. Closes on outside click.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  icon: string;
  group: string;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export default function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q)
    );
  }, [query, commands]);

  // Group for rendering while keeping a flat index for active tracking.
  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    filtered.forEach(c => {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    });
    return [...map.entries()];
  }, [filtered]);

  // Keyboard handling inside the palette.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(a => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(a => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[active];
        if (cmd) { cmd.run(); onClose(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, active, onClose]);

  // Keep active in range as the list shrinks.
  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [filtered.length, active]);

  // Scroll active into view.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={e => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <span style={{ color: 'var(--text-3)', fontSize: '1.1rem' }}>⌘</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type a command or search…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
          />
          <span className="cmdk-hint">ESC</span>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="cmdk-empty">No commands match “{query}”.</div>
          )}
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="cmdk-group-label">{group}</div>
              {items.map(cmd => {
                flatIndex++;
                const isActive = flatIndex === active;
                return (
                  <div
                    key={cmd.id}
                    data-active={isActive}
                    className={`cmdk-item${isActive ? ' active' : ''}`}
                    onMouseEnter={() => setActive(flatIndex)}
                    onClick={() => { cmd.run(); onClose(); }}
                  >
                    <span className="cmdk-item-icon">{cmd.icon}</span>
                    <span className="cmdk-item-label">{cmd.label}</span>
                    {cmd.hint && <span className="cmdk-item-hint">{cmd.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
