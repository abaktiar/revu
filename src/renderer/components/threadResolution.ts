import type { ActivityEvent, CommentNode, CommentThread } from '@shared/types';

// CodeCommit has no native "resolve thread" concept, so resolution is conveyed
// as a marker reply posted into the thread. Resolving posts [revu:resolved];
// reopening posts [revu:reopened]. The current state is whichever marker is
// most recent, which makes it team-shared (every revu reads the same thread)
// and append-only (no cross-user delete needed — a teammate can reopen a
// thread someone else resolved just by posting a newer marker).
export const RESOLVE_MARKER = '[revu:resolved]';
export const REOPEN_MARKER = '[revu:reopened]';

export function isResolveMarker(content: string): boolean {
  return content.trim().startsWith(RESOLVE_MARKER);
}

export function isReopenMarker(content: string): boolean {
  return content.trim().startsWith(REOPEN_MARKER);
}

// A marker comment is one whose (non-deleted) content is one of our markers.
// These are hidden from the normal comment list and surfaced as the
// resolution status line instead.
export function isMarkerComment(c: CommentNode): boolean {
  if (c.deleted) return false;
  return isResolveMarker(c.content) || isReopenMarker(c.content);
}

export interface ThreadResolution {
  resolved: boolean;
  // Who/when set the current state — read off the deciding marker comment.
  by?: string;
  at?: string;
}

// Resolution state = the latest non-deleted marker comment in the thread.
export function threadResolution(thread: CommentThread): ThreadResolution {
  let best: { resolved: boolean; by?: string; at?: string; t: number } | null =
    null;
  for (const c of thread.comments) {
    if (c.deleted) continue;
    const resolve = isResolveMarker(c.content);
    const reopen = isReopenMarker(c.content);
    if (!resolve && !reopen) continue;
    const t = c.createdAt ? Date.parse(c.createdAt) : 0;
    if (!best || t >= best.t) {
      best = { resolved: resolve, by: c.authorArn, at: c.createdAt, t };
    }
  }
  return best
    ? { resolved: best.resolved, by: best.by, at: best.at }
    : { resolved: false };
}

// The comments to actually display — markers stripped out (they drive the
// status line, not the conversation).
export function visibleComments(thread: CommentThread): CommentNode[] {
  return thread.comments.filter((c) => !isMarkerComment(c));
}

// True for an activity-timeline entry that is one of our resolve/reopen marker
// comments — those are an implementation detail of the resolve feature, not a
// real comment, so the timeline filters them out.
export function isResolutionMarkerEvent(ev: ActivityEvent): boolean {
  if (ev.type !== 'comment') return false;
  const t = (ev.commentExcerpt ?? '').trim();
  return t.startsWith(RESOLVE_MARKER) || t.startsWith(REOPEN_MARKER);
}
