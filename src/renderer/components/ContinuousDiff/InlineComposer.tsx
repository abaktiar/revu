import { useEffect, useRef, useState } from 'react';
import type { RelativeFileVersion } from '@shared/types';

// How long to wait after the last keystroke before persisting the draft. Long
// enough to coalesce rapid typing into one round-trip; short enough that the
// "Saved" indicator appears soon after the reviewer stops.
const AUTOSAVE_DEBOUNCE_MS = 500;
// Cadence for refreshing the "Xs ago" relative time in the indicator. Cheap
// enough that the savings of a slower interval don't justify the stale label.
const RELATIVE_TICK_MS = 10_000;

interface Props {
  side: RelativeFileVersion;
  filePath: string;
  line: number;
  initialContent?: string;
  draftId?: string;
  posting: boolean;
  onPost: (content: string) => Promise<void>;
  onSaveDraft: (content: string) => Promise<void>;
  onDeleteDraft: () => Promise<void>;
  onCancel: () => void;
}

export function InlineComposer({
  side,
  filePath,
  line,
  initialContent = '',
  draftId,
  posting,
  onPost,
  onSaveDraft,
  onDeleteDraft,
  onCancel,
}: Props): JSX.Element {
  const [text, setText] = useState(initialContent);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(
    initialContent ? Date.now() : null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSavedTextRef = useRef<string>(initialContent);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
  }, []);

  // Debounced auto-save. Skips empty text (no point persisting an empty
  // draft) and skips when the text is unchanged from the last successful save
  // (avoids a save round-trip on every focus/blur). The save call is fire-and-
  // forget at the React layer; errors surface as `saveError` and the draft
  // stays editable.
  useEffect(() => {
    if (text === lastSavedTextRef.current) return;
    if (!text.trim()) return;
    const handle = setTimeout(() => {
      const snapshot = text;
      setSaving(true);
      setSaveError(null);
      onSaveDraft(snapshot)
        .then(() => {
          lastSavedTextRef.current = snapshot;
          setSavedAt(Date.now());
        })
        .catch((e: unknown) => {
          setSaveError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setSaving(false));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [text, onSaveDraft]);

  // Re-render every 10s so "12s ago" advances. The interval only runs while
  // there's a saved timestamp to refresh, so an idle composer with no draft
  // pays zero.
  useEffect(() => {
    if (savedAt === null) return;
    const id = setInterval(() => forceTick((n) => n + 1), RELATIVE_TICK_MS);
    return () => clearInterval(id);
  }, [savedAt]);

  async function wrap(fn: () => Promise<void>): Promise<void> {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (text.trim() && !posting) void wrap(() => onPost(text));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="inline-composer">
      <div className="inline-composer-head">
        <span>
          New comment · <code>{filePath}</code>:<b>{line}</b> · {side}
        </span>
        <span className="grow" />
        <DraftStatus
          saving={saving}
          savedAt={savedAt}
          saveError={saveError}
          hasText={text.trim().length > 0}
        />
        <span className="kbd-hint">
          <kbd>{macish() ? '⌘' : 'Ctrl'}</kbd>+<kbd>↵</kbd> post ·{' '}
          <kbd>Esc</kbd> cancel
        </span>
      </div>
      <textarea
        ref={textareaRef}
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Leave a comment…"
      />
      <div className="inline-composer-actions">
        {err && <span className="hint warn">{err}</span>}
        <span className="grow" />
        {draftId && (
          <button onClick={() => void wrap(() => onDeleteDraft())}>
            Delete draft
          </button>
        )}
        <button onClick={onCancel}>Cancel</button>
        <button
          className="primary"
          onClick={() => void wrap(() => onPost(text))}
          disabled={posting || !text.trim()}
        >
          {posting ? 'Posting…' : 'Post comment'}
        </button>
      </div>
    </div>
  );
}

function DraftStatus({
  saving,
  savedAt,
  saveError,
  hasText,
}: {
  saving: boolean;
  savedAt: number | null;
  saveError: string | null;
  hasText: boolean;
}): JSX.Element | null {
  if (saveError) {
    return (
      <span className="hint warn" title={saveError}>
        Could not save draft
      </span>
    );
  }
  if (saving) {
    return <span className="hint">Saving…</span>;
  }
  if (savedAt !== null && hasText) {
    return <span className="hint">Draft saved {fmtRel(savedAt)}</span>;
  }
  return null;
}

function fmtRel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function macish(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}
