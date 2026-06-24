import { useEffect, useRef, useState } from 'react';
import type { CommentNode, CommentThread } from '@shared/types';
import { Markdown } from '../Markdown';
import { CommentReactions } from '../CommentReactions';
import {
  threadResolution,
  visibleComments,
} from '../threadResolution';

interface Props {
  thread: CommentThread;
  posting: boolean;
  onReply: (content: string) => Promise<void>;
  // ARN of the caller (so we know which comments to offer "Delete" on) and
  // the delete handler itself. Optional so existing callers don't break;
  // when omitted, no Delete affordance is rendered.
  selfArn?: string;
  onDeleteComment?: (commentId: string) => Promise<void>;
  // Emoji reactions: set/replace/remove the caller's reaction on a comment.
  onReact?: (commentId: string, value: string) => void;
  // Resolve / reopen the whole thread (team-shared via a marker reply).
  onSetResolved?: (resolved: boolean) => Promise<void>;
}

export function InlineThread({
  thread,
  posting,
  onReply,
  selfArn,
  onDeleteComment,
  onReact,
  onSetResolved,
}: Props): JSX.Element {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  const resolution = threadResolution(thread);
  const comments = visibleComments(thread);
  // Resolved threads collapse their conversation to keep the diff tidy; the
  // reviewer can expand it on demand. Reopening (or any open thread) shows it.
  const [expanded, setExpanded] = useState(false);
  const showComments = !resolution.resolved || expanded;

  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (replying) replyRef.current?.focus();
  }, [replying]);

  async function submit(): Promise<void> {
    if (!text.trim()) return;
    setErr(null);
    try {
      await onReply(text.trim());
      setText('');
      setReplying(false);
      // Make sure the new reply is visible even on a resolved (collapsed)
      // thread — otherwise it lands inside the hidden section and looks lost.
      setExpanded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (text.trim() && !posting) void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setReplying(false);
      setText('');
    }
  }

  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(commentId: string): Promise<void> {
    if (!onDeleteComment) return;
    setDeletingId(commentId);
    try {
      await onDeleteComment(commentId);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSetResolved(resolved: boolean): Promise<void> {
    if (!onSetResolved) return;
    setResolving(true);
    try {
      await onSetResolved(resolved);
      // After resolving, collapse; after reopening, keep it open.
      setExpanded(!resolved ? true : false);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className={`inline-thread${resolution.resolved ? ' is-resolved' : ''}`}>
      {resolution.resolved && (
        <div className="thread-resolved-bar">
          <span className="thread-resolved-check" aria-hidden>
            ✓
          </span>
          <span className="thread-resolved-label">
            Resolved
            {resolution.by ? ` by ${shortArn(resolution.by)}` : ''}
          </span>
          {comments.length > 0 && (
            <button
              type="button"
              className="thread-resolved-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? 'Hide conversation'
                : `Show conversation (${comments.length})`}
            </button>
          )}
          {onSetResolved && (
            <button
              type="button"
              className="thread-reopen"
              disabled={resolving}
              onClick={() => void handleSetResolved(false)}
            >
              {resolving ? 'Reopening…' : 'Reopen'}
            </button>
          )}
        </div>
      )}

      {showComments && (
        <ol className="thread-list">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentLine
                c={c}
                canDelete={
                  !!selfArn &&
                  !!onDeleteComment &&
                  !c.deleted &&
                  c.authorArn === selfArn
                }
                deleting={deletingId === c.id}
                onDelete={() => void handleDelete(c.id)}
                onReact={onReact}
              />
            </li>
          ))}
        </ol>
      )}

      {!replying ? (
        <div className="thread-actions">
          <button onClick={() => setReplying(true)}>Reply</button>
          {onSetResolved && !resolution.resolved && (
            <button
              type="button"
              className="thread-resolve"
              disabled={resolving}
              onClick={() => void handleSetResolved(true)}
            >
              {resolving ? 'Resolving…' : 'Resolve'}
            </button>
          )}
        </div>
      ) : (
        <div className="reply-box">
          <textarea
            ref={replyRef}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Write a reply…"
          />
          <div className="reply-actions">
            {err && <span className="hint warn">{err}</span>}
            <span className="grow" />
            <button
              onClick={() => {
                setReplying(false);
                setText('');
              }}
            >
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

function CommentLine({
  c,
  canDelete,
  deleting,
  onDelete,
  onReact,
}: {
  c: CommentNode;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  onReact?: (commentId: string, value: string) => void;
}): JSX.Element {
  return (
    <div className={`comment${c.deleted ? ' deleted' : ''}`}>
      <div className="comment-head">
        <span className="author">{shortArn(c.authorArn)}</span>
        <span className="when">{fmt(c.createdAt)}</span>
        {canDelete && (
          <>
            <span className="grow" />
            <button
              type="button"
              className="comment-delete"
              disabled={deleting}
              onClick={onDelete}
              aria-label="Delete this comment"
              title="Delete this comment"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </>
        )}
      </div>
      <div className="comment-body">
        {c.deleted ? <i>(deleted)</i> : <Markdown source={c.content} />}
      </div>
      {!c.deleted && onReact && (
        <CommentReactions comment={c} onReact={onReact} />
      )}
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
