import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  ApprovalAction,
  AwsProfileInfo,
  CommentDraft,
  CommentNode,
  CommentThread,
  DeleteCommentInput,
  ExpandLinesRequest,
  ExpandLinesResponse,
  FileDiff,
  FileDiffEntry,
  FilePair,
  IpcResult,
  ListPRsFilter,
  ManualCredentialsInput,
  PostCommentInput,
  PostReplyInput,
  PRDifferences,
  ListDoneEvent,
  ListErrorEvent,
  ListItemEvent,
  PullRequestApprovalView,
  PullRequestDetail,
  PullRequestMergeability,
  RelativeFileVersion,
  RepositorySummary,
  ReviewedFile,
} from '@shared/types';

const CH = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  credsSave: 'creds:save',
  credsClear: 'creds:clear',
  awsListProfiles: 'aws:list-profiles',
  reposList: 'repos:list',
  // See main: streaming PR-list session channels.
  prsListStart: 'prs:list-start',
  prsListCancel: 'prs:list-cancel',
  prsListItem: 'prs:list-item',
  prsListDone: 'prs:list-done',
  prsListError: 'prs:list-error',
  prsGet: 'prs:get',
  prsDifferences: 'prs:differences',
  prsFilePair: 'prs:file-pair',
  prsFileDiff: 'prs:file-diff',
  prsExpandLines: 'prs:expand-lines',
  prsWebUrl: 'prs:web-url',
  commentsList: 'comments:list',
  commentsPost: 'comments:post',
  commentsReply: 'comments:reply',
  commentsDelete: 'comments:delete',
  draftsList: 'drafts:list',
  draftsSave: 'drafts:save',
  draftsDelete: 'drafts:delete',
  approvalGet: 'approval:get',
  approvalUpdate: 'approval:update',
  mergeabilityGet: 'mergeability:get',
  reviewedList: 'reviewed:list',
  reviewedToggle: 'reviewed:toggle',
  cacheInvalidatePr: 'cache:invalidate-pr',
  cacheInvalidateRepo: 'cache:invalidate-repo',
  cacheClearAll: 'cache:clear-all',
} as const;

// Pass-through type for read calls so the renderer can opt out of cache.
export interface ReadOpts {
  forceFresh?: boolean;
}

const api = {
  platform: process.platform,
  settings: {
    get: (): Promise<IpcResult<AppSettings>> =>
      ipcRenderer.invoke(CH.settingsGet),
    set: (next: AppSettings): Promise<IpcResult<AppSettings>> =>
      ipcRenderer.invoke(CH.settingsSet, next),
  },
  creds: {
    save: (input: ManualCredentialsInput): Promise<IpcResult<AppSettings>> =>
      ipcRenderer.invoke(CH.credsSave, input),
    clear: (): Promise<IpcResult<AppSettings>> =>
      ipcRenderer.invoke(CH.credsClear),
  },
  aws: {
    listProfiles: (): Promise<IpcResult<AwsProfileInfo[]>> =>
      ipcRenderer.invoke(CH.awsListProfiles),
  },
  repos: {
    list: (opts?: ReadOpts): Promise<IpcResult<RepositorySummary[]>> =>
      ipcRenderer.invoke(CH.reposList, opts),
  },
  prs: {
    // Start a streaming PR-list session. The renderer pre-generates sessionId
    // (e.g. crypto.randomUUID()) so it can subscribe to item/done/error
    // events *before* the IPC call lands. The returned promise resolves once
    // the session is registered in main — actual results arrive over the
    // event channels below.
    startList: (payload: {
      sessionId: string;
      repositoryName: string;
      filter: ListPRsFilter;
      forceFresh?: boolean;
    }): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(CH.prsListStart, payload),
    // Cooperative cancel. Idempotent — safe to call on unmount even if the
    // session already completed.
    cancelList: (sessionId: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(CH.prsListCancel, sessionId),
    // Subscribe to per-PR results streamed during *any* active session.
    // The handler must filter by sessionId itself (a refresh racing a
    // pending Load more is rare but possible). Returns unsubscribe.
    onListItem: (
      handler: (event: ListItemEvent) => void,
    ): (() => void) => {
      const listener = (_e: unknown, payload: ListItemEvent): void =>
        handler(payload);
      ipcRenderer.on(CH.prsListItem, listener);
      return () => ipcRenderer.removeListener(CH.prsListItem, listener);
    },
    onListDone: (
      handler: (event: ListDoneEvent) => void,
    ): (() => void) => {
      const listener = (_e: unknown, payload: ListDoneEvent): void =>
        handler(payload);
      ipcRenderer.on(CH.prsListDone, listener);
      return () => ipcRenderer.removeListener(CH.prsListDone, listener);
    },
    onListError: (
      handler: (event: ListErrorEvent) => void,
    ): (() => void) => {
      const listener = (_e: unknown, payload: ListErrorEvent): void =>
        handler(payload);
      ipcRenderer.on(CH.prsListError, listener);
      return () => ipcRenderer.removeListener(CH.prsListError, listener);
    },
    get: (
      repositoryName: string,
      pullRequestId: string,
      opts?: ReadOpts,
    ): Promise<IpcResult<PullRequestDetail>> =>
      ipcRenderer.invoke(CH.prsGet, repositoryName, pullRequestId, opts),
    differences: (
      repositoryName: string,
      pullRequestId: string,
      opts?: ReadOpts,
    ): Promise<IpcResult<PRDifferences>> =>
      ipcRenderer.invoke(
        CH.prsDifferences,
        repositoryName,
        pullRequestId,
        opts,
      ),
    filePair: (
      repositoryName: string,
      beforeBlobId: string | undefined,
      afterBlobId: string | undefined,
    ): Promise<IpcResult<FilePair>> =>
      ipcRenderer.invoke(CH.prsFilePair, repositoryName, beforeBlobId, afterBlobId),
    fileDiff: (
      repositoryName: string,
      entry: FileDiffEntry,
      opts?: ReadOpts,
    ): Promise<IpcResult<FileDiff>> =>
      ipcRenderer.invoke(CH.prsFileDiff, repositoryName, entry, opts),
    expandLines: (
      request: ExpandLinesRequest,
    ): Promise<IpcResult<ExpandLinesResponse>> =>
      ipcRenderer.invoke(CH.prsExpandLines, request),
    webUrl: (
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<string | undefined>> =>
      ipcRenderer.invoke(CH.prsWebUrl, repositoryName, pullRequestId),
  },
  comments: {
    list: (
      repositoryName: string,
      pullRequestId: string,
      opts?: ReadOpts,
    ): Promise<IpcResult<CommentThread[]>> =>
      ipcRenderer.invoke(CH.commentsList, repositoryName, pullRequestId, opts),
    post: (input: PostCommentInput): Promise<IpcResult<CommentThread>> =>
      ipcRenderer.invoke(CH.commentsPost, input),
    reply: (input: PostReplyInput): Promise<IpcResult<CommentThread>> =>
      ipcRenderer.invoke(CH.commentsReply, input),
    delete: (input: DeleteCommentInput): Promise<IpcResult<CommentNode>> =>
      ipcRenderer.invoke(CH.commentsDelete, input),
  },
  drafts: {
    list: (pullRequestId: string): Promise<IpcResult<CommentDraft[]>> =>
      ipcRenderer.invoke(CH.draftsList, pullRequestId),
    save: (input: {
      id?: string;
      pullRequestId: string;
      repositoryName: string;
      filePath: string;
      filePosition: number;
      relativeFileVersion: RelativeFileVersion;
      content: string;
      inReplyTo?: string;
    }): Promise<IpcResult<CommentDraft>> =>
      ipcRenderer.invoke(CH.draftsSave, input),
    delete: (id: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(CH.draftsDelete, id),
  },
  approval: {
    get: (
      repositoryName: string,
      pullRequestId: string,
      opts?: ReadOpts,
    ): Promise<IpcResult<PullRequestApprovalView>> =>
      ipcRenderer.invoke(CH.approvalGet, repositoryName, pullRequestId, opts),
    update: (
      repositoryName: string,
      pullRequestId: string,
      action: ApprovalAction,
    ): Promise<IpcResult<PullRequestApprovalView>> =>
      ipcRenderer.invoke(CH.approvalUpdate, repositoryName, pullRequestId, action),
  },
  mergeability: {
    get: (
      repositoryName: string,
      pullRequestId: string,
      opts?: ReadOpts,
    ): Promise<IpcResult<PullRequestMergeability>> =>
      ipcRenderer.invoke(
        CH.mergeabilityGet,
        repositoryName,
        pullRequestId,
        opts,
      ),
  },
  cache: {
    invalidatePr: (
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(CH.cacheInvalidatePr, repositoryName, pullRequestId),
    invalidateRepo: (repositoryName: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(CH.cacheInvalidateRepo, repositoryName),
    clearAll: (): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(CH.cacheClearAll),
  },
  reviewed: {
    list: (pullRequestId: string): Promise<IpcResult<ReviewedFile[]>> =>
      ipcRenderer.invoke(CH.reviewedList, pullRequestId),
    toggle: (
      pullRequestId: string,
      filePath: string,
      afterCommitId: string,
      reviewed: boolean,
    ): Promise<IpcResult<ReviewedFile | null>> =>
      ipcRenderer.invoke(
        CH.reviewedToggle,
        pullRequestId,
        filePath,
        afterCommitId,
        reviewed,
      ),
  },
} as const;

contextBridge.exposeInMainWorld('revu', api);

export type RevuApi = typeof api;
