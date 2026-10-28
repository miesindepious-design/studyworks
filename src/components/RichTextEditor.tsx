import { useRef, useEffect, useCallback, useState } from 'react';

interface RichTextEditorProps {
  value:       string;
  onChange:    (html: string) => void;
  placeholder?: string;
  minHeight?:  string;
}

type FormatCmd =
  | 'bold' | 'italic' | 'underline' | 'strikeThrough'
  | 'insertUnorderedList' | 'insertOrderedList'
  | 'formatBlock' | 'hiliteColor';

const TOOLBAR: { label: string; cmd: FormatCmd; arg?: string; title: string }[] = [
  { label: 'B',  cmd: 'bold',                title: 'Bold (⌘B)'      },
  { label: 'I',  cmd: 'italic',              title: 'Italic (⌘I)'    },
  { label: 'U',  cmd: 'underline',           title: 'Underline (⌘U)' },
  { label: 'S',  cmd: 'strikeThrough',       title: 'Strikethrough'  },
  { label: 'H2', cmd: 'formatBlock', arg: 'h2', title: 'Heading 2'   },
  { label: 'H3', cmd: 'formatBlock', arg: 'h3', title: 'Heading 3'   },
  { label: '•',  cmd: 'insertUnorderedList', title: 'Bullet list'    },
  { label: '1.', cmd: 'insertOrderedList',   title: 'Numbered list'  },
];

const HIGHLIGHT_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff'];

export default function RichTextEditor({
  value, onChange, placeholder = 'Content…', minHeight = '120px',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showFloatingToolbar, setShowFloatingToolbar] = useState(false);
  const [floatingPos, setFloatingPos] = useState({ top: 0, left: 0 });

  // Sync external value changes (e.g. when editing a different note)
  useEffect(() => {
    if (!editorRef.current) return;
    if (isInternalChange.current) { isInternalChange.current = false; return; }
    // Only update DOM if content actually differs to avoid cursor jump
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    isInternalChange.current = true;
    onChange(editorRef.current.innerHTML);
  }, [onChange]);

  const exec = (cmd: FormatCmd, arg?: string) => {
    document.execCommand(cmd, false, arg);
    editorRef.current?.focus();
    handleInput();
  };

  const applyHighlight = (color: string) => {
    exec('hiliteColor', color);
    setShowHighlightPicker(false);
  };

  const isActive = (cmd: string, arg?: string) => {
    try { return document.queryCommandState(cmd) || (arg ? document.queryCommandValue('formatBlock') === arg : false); }
    catch { return false; }
  };

  // Floating toolbar on selection
  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !editorRef.current) {
      setShowFloatingToolbar(false);
      return;
    }
    if (!editorRef.current.contains(sel.anchorNode)) {
      setShowFloatingToolbar(false);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setShowFloatingToolbar(false);
      return;
    }
    const editorRect = editorRef.current.getBoundingClientRect();
    setFloatingPos({
      top: rect.top - editorRect.top - 50,
      left: rect.left - editorRect.left + rect.width / 2 - 120,
    });
    setShowFloatingToolbar(true);
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [handleSelectionChange]);

  // Markdown shortcuts
  // NOTE: handler defined but not yet wired to the editor element;
  // keeping the implementation would require attaching `onKeyDown` to the
  // editable container. Removing the unused binding to satisfy typecheck.

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface-1)', transition: 'border-color var(--transition), box-shadow var(--transition)' }}
      onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--border-focus)', e.currentTarget.style.boxShadow = '0 0 0 3px rgb(99 102 241 / .12)')}
      onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--border)', e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', padding: '6px 8px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 'var(--radius) var(--radius) 0 0' }}>
        {TOOLBAR.map(btn => (
          <button
            key={btn.label}
            type="button"
            title={btn.title}
            onMouseDown={e => { e.preventDefault(); exec(btn.cmd, btn.arg); }}
            style={{
              width: '28px', height: '26px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 'var(--radius-sm)',
              background: isActive(btn.cmd, btn.arg) ? 'var(--accent-soft)' : 'transparent',
              color: isActive(btn.cmd, btn.arg) ? 'var(--accent)' : 'var(--text-2)',
              cursor: 'pointer', fontSize: btn.label.length > 1 ? '0.7rem' : '0.875rem',
              fontWeight: btn.label === 'B' ? 800 : btn.label === 'I' ? 400 : 600,
              fontStyle: btn.label === 'I' ? 'italic' : 'normal',
              transition: 'background var(--transition)',
            }}
          >
            {btn.label}
          </button>
        ))}
        <div style={{ width: '1px', background: 'var(--border)', margin: '2px 4px', alignSelf: 'stretch' }} />
        {/* Highlight color picker */}
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            title="Highlight color"
            onMouseDown={e => { e.preventDefault(); setShowHighlightPicker(p => !p); }}
            style={{
              width: '28px', height: '26px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 'var(--radius-sm)',
              background: showHighlightPicker ? 'var(--accent-soft)' : 'transparent',
              color: 'var(--text-2)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
            }}
          >
            🖍️
          </button>
          {showHighlightPicker && (
            <div style={{
              position: 'absolute', top: '110%', left: 0, zIndex: 60,
              background: 'var(--surface-1)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '6px', display: 'flex', gap: '4px',
              boxShadow: 'var(--shadow-lg)',
            }}>
              {HIGHLIGHT_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  title={`Highlight ${c}`}
                  onMouseDown={e => { e.preventDefault(); applyHighlight(c); }}
                  style={{
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: c, border: '2px solid transparent', cursor: 'pointer',
                  }}
                />
              ))}
              <button
                type="button"
                title="Remove highlight"
                onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat', false); handleInput(); setShowHighlightPicker(false); }}
                style={{
                  width: '22px', height: '22px', borderRadius: '50%',
                  background: 'var(--surface-2)', border: '2px solid var(--border)',
                  cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
        <div style={{ width: '1px', background: 'var(--border)', margin: '2px 4px', alignSelf: 'stretch' }} />
        <button
          type="button"
          title="Clear formatting"
          onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat', false); handleInput(); }}
          style={{ padding: '0 6px', height: '26px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }}
        >
          T✕
        </button>
      </div>

      {/* Floating toolbar on text selection */}
      {showFloatingToolbar && (
        <div style={{
          position: 'absolute', top: floatingPos.top, left: Math.max(0, floatingPos.left),
          zIndex: 70, background: 'var(--text)', borderRadius: '8px',
          display: 'flex', gap: '2px', padding: '4px 6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}>
          {TOOLBAR.map(btn => (
            <button
              key={btn.label}
              type="button"
              title={btn.title}
              onMouseDown={e => { e.preventDefault(); exec(btn.cmd, btn.arg); }}
              style={{
                width: '26px', height: '24px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: '4px',
                background: isActive(btn.cmd, btn.arg) ? 'rgba(255,255,255,0.25)' : 'transparent',
                color: '#fff', cursor: 'pointer', fontSize: btn.label.length > 1 ? '0.65rem' : '0.8rem',
                fontWeight: btn.label === 'B' ? 800 : btn.label === 'I' ? 400 : 600,
                fontStyle: btn.label === 'I' ? 'italic' : 'normal',
              }}
            >
              {btn.label}
            </button>
          ))}
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.2)', margin: '2px 2px', alignSelf: 'stretch' }} />
          {HIGHLIGHT_COLORS.map(c => (
            <button
              key={c}
              type="button"
              title={`Highlight ${c}`}
              onMouseDown={e => { e.preventDefault(); applyHighlight(c); }}
              style={{
                width: '20px', height: '20px', borderRadius: '50%',
                background: c, border: '2px solid rgba(255,255,255,0.3)', cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        style={{
          minHeight,
          padding: '0.625rem 0.875rem',
          outline: 'none',
          fontSize: '0.9rem',
          lineHeight: 1.7,
          color: 'var(--text)',
        }}
      />

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: var(--text-3);
          pointer-events: none;
        }
        [contenteditable] h2 { font-size: 1.125rem; font-weight: 700; margin: 0.5rem 0 0.25rem; }
        [contenteditable] h3 { font-size: 1rem; font-weight: 700; margin: 0.5rem 0 0.25rem; }
        [contenteditable] ul, [contenteditable] ol { padding-left: 1.5rem; margin: 0.25rem 0; }
        [contenteditable] li { margin-bottom: 0.2rem; }
        [contenteditable] strong { font-weight: 700; }
        [contenteditable] em { font-style: italic; }
        [contenteditable] u { text-decoration: underline; }
        [contenteditable] s { text-decoration: line-through; }
        [contenteditable] mark { border-radius: 2px; padding: 0 2px; }
        [contenteditable] code {
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 1px 5px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.85em;
        }
      `}</style>
    </div>
  );
}
