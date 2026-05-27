import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface Group {
  label: string;
  shortcuts: Shortcut[];
}

const macish = (): boolean =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

function buildGroups(): Group[] {
  const cmd = macish() ? '⌘' : 'Ctrl';
  return [
    {
      label: 'PR list',
      shortcuts: [
        { keys: ['j', '↓'], description: 'Next PR' },
        { keys: ['k', '↑'], description: 'Previous PR' },
        { keys: ['Home'], description: 'First PR' },
        { keys: ['End'], description: 'Last PR' },
        { keys: ['Enter'], description: 'Open PR' },
        { keys: ['/'], description: 'Focus filter' },
        { keys: ['Esc'], description: 'Clear filter' },
      ],
    },
    {
      label: 'Diff',
      shortcuts: [
        { keys: ['j'], description: 'Next file' },
        { keys: ['k'], description: 'Previous file' },
      ],
    },
    {
      label: 'Composer',
      shortcuts: [
        { keys: [cmd, '↵'], description: 'Post comment' },
        { keys: ['Esc'], description: 'Close composer' },
      ],
    },
  ];
}

export function KeyboardHelpOverlay({ open, onClose }: Props): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const groups = buildGroups();

  return (
    <div
      className="help-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h3>Keyboard shortcuts</h3>
          <button onClick={onClose} aria-label="Close shortcuts">
            Close
          </button>
        </div>
        {groups.map((g) => (
          <section key={g.label} className="help-group">
            <div className="help-group-label">{g.label}</div>
            <ul>
              {g.shortcuts.map((s) => (
                <li key={s.description}>
                  <span className="help-keys">
                    {s.keys.map((k, i) => (
                      <span key={i}>
                        <kbd>{k}</kbd>
                        {i < s.keys.length - 1 && (
                          <span className="help-or">or</span>
                        )}
                      </span>
                    ))}
                  </span>
                  <span className="help-desc">{s.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
