import { useRef, useEffect, useCallback } from 'react';

interface RichTextEditorProps {
  value:       string;
  onChange:    (html: string) => void;
  placeholder?: string;
  minHeight?:  string;
}

type FormatCmd =
  | 'bold' | 'italic' | 'underline' | 'strikeThrough'
  | 'insertUnorderedList' | 'insertOrderedList'
  | 'formatBlock';

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

export default function RichTextEditor({
  value, onChange, placeholder = 'Content…', minHeight = '120px',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

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

  const isActive = (cmd: string, arg?: string) => {
    try { return document.queryCommandState(cmd) || (arg ? document.queryCommandValue('formatBlock') === arg : false); }
    catch { return false; }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface)', transition: 'border-color var(--transition), box-shadow var(--transition)' }}
      onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--border-focus)', e.currentTarget.style.boxShadow = '0 0 0 3px rgb(99 102 241 / .12)')}
      onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--border)', e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', padding: '6px 8px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
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
        <button
          type="button"
          title="Clear formatting"
          onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat', false); handleInput(); }}
          style={{ padding: '0 6px', height: '26px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }}
        >
          T✕
        </button>
      </div>

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
      `}</style>
    </div>
  );
}
