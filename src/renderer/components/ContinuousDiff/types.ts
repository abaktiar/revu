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
