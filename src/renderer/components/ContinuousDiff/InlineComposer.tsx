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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
  }, []);

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
          onClick={() => void wrap(() => onSaveDraft(text))}
          disabled={!text.trim()}
        >
          Save draft
        </button>
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

function macish(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}
