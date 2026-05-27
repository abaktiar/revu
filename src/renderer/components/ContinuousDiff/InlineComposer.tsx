import { useEffect, useRef, useState } from 'react';
import type { RelativeFileVersion } from '@shared/types';

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
  const [confirming, setConfirming] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveDraftBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
  }, []);

  // Move keyboard focus to the primary "Save draft" action when the confirm
  // prompt opens. Esc still returns to edit (handled in onKeyDown below), so
  // the keyboard path is: type · Esc · (focused) Save draft / Tab to Discard.
  useEffect(() => {
    if (confirming) saveDraftBtnRef.current?.focus();
  }, [confirming]);

  // "Has the reviewer typed something worth preserving?" Empty text never
  // prompts (lets the user bail without ceremony), and text identical to the
  // existing draft body never prompts (no changes to save).
  const hasUnsavedChanges =
    text.trim() !== '' && text !== initialContent;

  async function wrap(fn: () => Promise<void>): Promise<void> {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function requestClose(): void {
    if (hasUnsavedChanges) {
      setConfirming(true);
    } else {
      onCancel();
    }
  }

  async function saveAndClose(): Promise<void> {
    setSavingDraft(true);
    setErr(null);
    try {
      await onSaveDraft(text);
      onCancel();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setConfirming(false);
    } finally {
      setSavingDraft(false);
    }
  }

  function discardAndClose(): void {
    setConfirming(false);
    onCancel();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (confirming) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirming(false);
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (text.trim() && !posting) void wrap(() => onPost(text));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
    }
  }

  return (
    <div className="inline-composer">
      <div className="inline-composer-head">
        <span>
          New comment · <code>{filePath}</code>:<b>{line}</b> · {side}
        </span>
        <span className="grow" />
        <span className="kbd-hint">
          <kbd>{macish() ? '⌘' : 'Ctrl'}</kbd>+<kbd>↵</kbd> post ·{' '}
          <kbd>Esc</kbd> close
        </span>
      </div>
      <textarea
        ref={textareaRef}
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Leave a comment…"
        readOnly={confirming}
      />
      {confirming ? (
        <div className="inline-composer-actions confirming">
          <span className="hint">Save changes as a draft?</span>
          <span className="grow" />
          <button
            onClick={() => setConfirming(false)}
            disabled={savingDraft}
          >
            Keep editing
          </button>
          <button onClick={discardAndClose} disabled={savingDraft}>
            Discard
          </button>
          <button
            ref={saveDraftBtnRef}
            className="primary"
            onClick={() => void saveAndClose()}
            disabled={savingDraft}
          >
            {savingDraft ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      ) : (
        <div className="inline-composer-actions">
          {err && <span className="hint warn">{err}</span>}
          <span className="grow" />
          {draftId && (
            <button onClick={() => void wrap(() => onDeleteDraft())}>
              Delete draft
            </button>
          )}
          <button onClick={requestClose}>Close</button>
          <button
            className="primary"
            onClick={() => void wrap(() => onPost(text))}
            disabled={posting || !text.trim()}
          >
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      )}
    </div>
  );
}

function macish(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}
