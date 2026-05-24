import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  AwsProfileInfo,
  CommentDraft,
  CommentThread,
  FilePair,
  IpcResult,
  ListPRsFilter,
  ManualCredentialsInput,
  PostCommentInput,
  PostReplyInput,
  PRDifferences,
  PullRequestDetail,
  PullRequestSummary,
  RelativeFileVersion,
  RepositorySummary,
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
  commentsList: 'comments:list',
  commentsPost: 'comments:post',
  commentsReply: 'comments:reply',
  draftsList: 'drafts:list',
  draftsSave: 'drafts:save',
  draftsDelete: 'drafts:delete',
} as const;

const api = {
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
    list: (): Promise<IpcResult<RepositorySummary[]>> =>
      ipcRenderer.invoke(CH.reposList),
  },
  prs: {
    list: (
      repositoryName: string,
      filter: ListPRsFilter,
    ): Promise<IpcResult<PullRequestSummary[]>> =>
      ipcRenderer.invoke(CH.prsList, repositoryName, filter),
    get: (
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<PullRequestDetail>> =>
      ipcRenderer.invoke(CH.prsGet, repositoryName, pullRequestId),
    differences: (
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<PRDifferences>> =>
      ipcRenderer.invoke(CH.prsDifferences, repositoryName, pullRequestId),
    filePair: (
      repositoryName: string,
      beforeBlobId: string | undefined,
      afterBlobId: string | undefined,
    ): Promise<IpcResult<FilePair>> =>
      ipcRenderer.invoke(CH.prsFilePair, repositoryName, beforeBlobId, afterBlobId),
  },
  comments: {
    list: (
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<CommentThread[]>> =>
      ipcRenderer.invoke(CH.commentsList, repositoryName, pullRequestId),
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
} as const;

contextBridge.exposeInMainWorld('revu', api);

export type RevuApi = typeof api;
