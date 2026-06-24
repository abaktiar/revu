import { useEffect, useRef, useState } from 'react';
import type { CommentNode } from '@shared/types';

// CodeCommit's supported emoji reactions (the GitHub-style set). We send the
// emoji character as the reactionValue; CodeCommit accepts it and normalizes.
// Counts come back keyed by emoji in `reactionCounts` and the caller's own
// reaction in `callerReactions` — we render both as-is so we don't depend on
// the exact key encoding AWS returns.
export const REACTION_EMOJIS = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];

// CodeCommit returns reaction keys without the emoji-presentation variation
// selector (e.g. the bare ❤ U+2764, not ❤️ U+2764+U+FE0F). Strip U+FE0F so our
// picker values, the caller's reactions, and the count keys all compare equal.
export function normalizeReaction(value: string): string {
  return value.replace(/\uFE0F/g, '');
}

interface Props {
  comment: CommentNode;
  // value is an emoji to set, or 'none' to clear the caller's reaction.
  onReact: (commentId: string, reactionValue: string) => void;
  // When true, render existing reactions read-only with no picker (e.g. the
  // per-commit diff, which is non-commentable).
  readOnly?: boolean;
}

export function CommentReactions({
  comment,
  onReact,
  readOnly,
}: Props): JSX.Element | null {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const counts = comment.reactionCounts ?? {};
  const mine = new Set((comment.callerReactions ?? []).map(normalizeReaction));
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const isMine = (emoji: string): boolean => mine.has(normalizeReaction(emoji));

  // Nothing to show and nothing to add — render nothing so quiet comments stay
  // quiet.
  if (entries.length === 0 && readOnly) return null;

  // Clicking your own reaction clears it; clicking any other emoji sets it
  // (CodeCommit replaces the caller's single reaction). Send the normalized
  // value so it matches the keys CodeCommit returns.
  const toggle = (value: string): void => {
    if (readOnly) return;
    const v = normalizeReaction(value);
    onReact(comment.id, mine.has(v) ? 'none' : v);
    setPickerOpen(false);
  };

  return (
    <div className="comment-reactions" ref={ref}>
      {entries.map(([emoji, n]) => (
        <button
          key={emoji}
          type="button"
          className={`reaction-pill${isMine(emoji) ? ' is-mine' : ''}`}
          onClick={() => toggle(emoji)}
          disabled={readOnly}
          title={isMine(emoji) ? 'Remove your reaction' : 'Toggle reaction'}
        >
          <span className="reaction-emoji" aria-hidden>
            {emoji}
          </span>
          <span className="reaction-count">{n}</span>
        </button>
      ))}
      {!readOnly && (
        <div className="reaction-add-wrap">
          <button
            type="button"
            className="reaction-add"
            aria-label="Add reaction"
            aria-expanded={pickerOpen}
            title="Add reaction"
            onClick={() => setPickerOpen((v) => !v)}
          >
            <span aria-hidden>🙂</span>
            <span className="reaction-add-plus" aria-hidden>
              +
            </span>
          </button>
          {pickerOpen && (
            <div className="reaction-picker" role="menu">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  className={`reaction-choice${isMine(emoji) ? ' is-mine' : ''}`}
                  onClick={() => toggle(emoji)}
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
