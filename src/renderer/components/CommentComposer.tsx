import { useState } from 'react';
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

export function CommentComposer({
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

  async function wrap(fn: () => Promise<void>): Promise<void> {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="composer">
      <div className="composer-head">
        <span>
          New comment · <code>{filePath}</code>:<b>{line}</b> · {side}
        </span>
      </div>
      <textarea
        autoFocus
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave a comment…"
      />
      <div className="composer-actions">
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
