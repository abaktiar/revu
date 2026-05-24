import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  AwsProfileInfo,
  IpcResult,
  ListPRsFilter,
  ManualCredentialsInput,
  PullRequestDetail,
  PullRequestSummary,
  RepositorySummary,
} from '@shared/types';

// Mirrors src/main/ipc.ts. Kept as string literals here so the preload bundle
// has no main-process imports.
const CH = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  credsSave: 'creds:save',
  credsClear: 'creds:clear',
  awsListProfiles: 'aws:list-profiles',
  reposList: 'repos:list',
  prsList: 'prs:list',
  prsGet: 'prs:get',
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
  },
} as const;

contextBridge.exposeInMainWorld('revu', api);

export type RevuApi = typeof api;
