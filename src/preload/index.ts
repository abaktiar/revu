import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  ApprovalAction,
  AwsProfileInfo,
  CommentDraft,
  CommentThread,
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
  PullRequestApprovalView,
  PullRequestDetail,
  PullRequestMergeability,
  PullRequestSummary,
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
  prsList: 'prs:list',
  prsGet: 'prs:get',
  prsDifferences: 'prs:differences',
  prsFilePair: 'prs:file-pair',
  prsFileDiff: 'prs:file-diff',
  prsExpandLines: 'prs:expand-lines',
  commentsList: 'comments:list',
  commentsPost: 'comments:post',
  commentsReply: 'comments:reply',
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
    list: (
      repositoryName: string,
      filter: ListPRsFilter,
      opts?: ReadOpts,
    ): Promise<IpcResult<PullRequestSummary[]>> =>
      ipcRenderer.invoke(CH.prsList, repositoryName, filter, opts),
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
