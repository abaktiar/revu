import type {
  CommentDraft,
  CommentThread,
  FileDiff,
  FileDiffEntry,
  PostCommentInput,
  RelativeFileVersion,
} from '@shared/types';

export interface ComposerLocation {
  filePath: string;
  line: number;
  side: RelativeFileVersion;
}

export interface DiffCallbacks {
  onPostComment: (input: PostCommentInput) => Promise<void>;
  onPostReply: (threadId: string, content: string) => Promise<void>;
  onSaveDraft: (input: {
    id?: string;
    filePath: string;
    filePosition: number;
    relativeFileVersion: RelativeFileVersion;
    content: string;
  }) => Promise<void>;
  onDeleteDraft: (id: string) => Promise<void>;
  // Soft-delete a posted CodeCommit comment. The renderer is responsible for
  // confirming the action with the user; the provider enforces author-only.
  onDeleteComment: (commentId: string) => Promise<void>;
  onToggleReviewed: (file: FileDiffEntry, next: boolean) => void;
}

export interface DiffContext {
  pullRequestId: string;
  repositoryName: string;
  beforeCommitId: string;
  afterCommitId: string;
  postingThreadId: string | null;
  // ARN of the currently authenticated user, when known. Used to decide
  // whether to render the "Delete" affordance on each posted comment.
  selfArn?: string;
  // True when this view is not commentable — typically the per-commit diff
  // shown when the user selects a commit from the sidebar. Comments are
  // anchored to the PR's commit pair, so opening a composer here would post
  // against the wrong commits. The diff still renders normally; we just hide
  // the "+" hover button, threads, composer, and the reviewed checkbox.
  readOnly?: boolean;
}

// A request to bring a specific comment thread into view. Created by
// ContinuousDiff.scrollToComment(), delivered to the one FileDiffSection whose
// path matches, which force-loads + expands the file and scrolls to the thread.
export interface RevealTarget {
  filePath: string;
  threadId: string;
  // Bumped on every scrollToComment call so re-selecting the same thread
  // re-triggers the reveal even when filePath + threadId are unchanged.
  nonce: number;
}

export interface FileSectionApi {
  // The active file is the topmost file whose section is currently visible.
  registerSection: (path: string, el: HTMLDivElement) => void;
  unregisterSection: (path: string) => void;
}

export type FileDiffCache = Map<string, FileDiff>;

export interface ThreadsByLine {
  // key: `${side}:${lineNumber}` → CommentThread[]
  byKey: Map<string, CommentThread[]>;
}

export function threadsForLineKey(side: RelativeFileVersion, line: number): string {
  return `${side}:${line}`;
}

export function buildThreadIndex(threads: CommentThread[]): ThreadsByLine {
  const byKey = new Map<string, CommentThread[]>();
  for (const t of threads) {
    if (!t.filePath || !t.filePosition || !t.relativeFileVersion) continue;
    const k = threadsForLineKey(t.relativeFileVersion, t.filePosition);
    const arr = byKey.get(k);
    if (arr) arr.push(t);
    else byKey.set(k, [t]);
  }
  return { byKey };
}

export interface DraftsByLine {
  byKey: Map<string, CommentDraft>;
}

export function buildDraftIndex(drafts: CommentDraft[]): DraftsByLine {
  const byKey = new Map<string, CommentDraft>();
  for (const d of drafts) {
    const k = threadsForLineKey(d.relativeFileVersion, d.filePosition);
    byKey.set(k, d);
  }
  return { byKey };
}
