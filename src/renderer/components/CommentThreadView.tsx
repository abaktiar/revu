import { useState } from 'react';
import type { CommentNode, CommentThread } from '@shared/types';

interface Props {
  thread: CommentThread;
  posting: boolean;
  onReply: (content: string) => Promise<void>;
}

export function CommentThreadView({
  thread,
  posting,
  onReply,
}: Props): JSX.Element {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!text.trim()) return;
    setErr(null);
    try {
      await onReply(text.trim());
      setText('');
      setReplying(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="thread">
      <div className="thread-head">
        <span className="thread-loc">
          {thread.filePath
            ? `${thread.filePath}:${thread.filePosition} (${thread.relativeFileVersion})`
            : 'General comment'}
        </span>
      </div>
      <ol className="thread-list">
        {thread.comments.map((c) => (
          <li key={c.id}>
            <CommentLine c={c} />
          </li>
        ))}
      </ol>
      {!replying ? (
        <div className="thread-actions">
          <button onClick={() => setReplying(true)}>Reply</button>
        </div>
      ) : (
        <div className="reply-box">
          <textarea
            autoFocus
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply…"
          />
          <div className="reply-actions">
            {err && <span className="hint warn">{err}</span>}
            <span className="grow" />
            <button onClick={() => { setReplying(false); setText(''); }}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => void submit()}
              disabled={posting || !text.trim()}
            >
              {posting ? 'Posting…' : 'Reply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentLine({ c }: { c: CommentNode }): JSX.Element {
  return (
    <div className={`comment${c.deleted ? ' deleted' : ''}`}>
      <div className="comment-head">
        <span className="author">{shortArn(c.authorArn)}</span>
        <span className="when">{fmt(c.createdAt)}</span>
      </div>
      <div className="comment-body">
        {c.deleted ? <i>(deleted)</i> : c.content}
      </div>
    </div>
  );
}

function shortArn(arn: string | undefined): string {
  if (!arn) return 'unknown';
  const i = arn.lastIndexOf('/');
  return i >= 0 ? arn.slice(i + 1) : arn;
}

function fmt(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}
