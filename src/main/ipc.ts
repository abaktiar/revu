import { ipcMain } from 'electron';
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
import { CodeCommitProvider } from './providers/CodeCommitProvider';
import type { ReviewProvider } from './providers/ReviewProvider';
import { listAwsProfiles } from './aws/profiles';
import {
  clearManualCredentials,
  loadSettings,
  readManualCredentials,
  saveManualCredentials,
  saveSettings,
} from './settings';
import { deleteDraft, listDrafts, saveDraft } from './drafts';

export const IPC = {
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

let provider: ReviewProvider | null = null;
let providerKey = '';

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function fail<T = never>(err: unknown): IpcResult<T> {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message };
}

function invalidateProvider(): void {
  provider = null;
  providerKey = '';
}

async function getProvider(): Promise<ReviewProvider> {
  const settings = await loadSettings();
  const creds =
    settings.credentialSource === 'keys' ? await readManualCredentials() : null;

  if (settings.credentialSource === 'keys' && !creds) {
    throw new Error(
      'Credential source is "keys" but no access keys are saved. Paste your AWS environment-variable block in Settings.',
    );
  }

  const key = [
    settings.credentialSource,
    settings.profile ?? '',
    settings.region ?? '',
    creds ? creds.accessKeyId : '',
    creds?.sessionToken ?? '',
  ].join('|');

  if (provider && key === providerKey) return provider;

  provider = new CodeCommitProvider({
    region: settings.region,
    profile:
      settings.credentialSource === 'profile' ? settings.profile : undefined,
    staticCredentials: creds ?? undefined,
  });
  providerKey = key;
  return provider;
}

export function registerIpc(): void {
  // ---- settings -------------------------------------------------------
  ipcMain.handle(IPC.settingsGet, async (): Promise<IpcResult<AppSettings>> => {
    try {
      return ok(await loadSettings());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    IPC.settingsSet,
    async (_e, next: AppSettings): Promise<IpcResult<AppSettings>> => {
      try {
        const saved = await saveSettings(next);
        invalidateProvider();
        return ok(saved);
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.credsSave,
    async (
      _e,
      input: ManualCredentialsInput,
    ): Promise<IpcResult<AppSettings>> => {
      try {
        await saveManualCredentials(input);
        invalidateProvider();
        return ok(await loadSettings());
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(IPC.credsClear, async (): Promise<IpcResult<AppSettings>> => {
    try {
      await clearManualCredentials();
      invalidateProvider();
      return ok(await loadSettings());
    } catch (err) {
      return fail(err);
    }
  });

  // ---- aws / repos / prs ----------------------------------------------
  ipcMain.handle(
    IPC.awsListProfiles,
    async (): Promise<IpcResult<AwsProfileInfo[]>> => {
      try {
        return ok(await listAwsProfiles());
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.reposList,
    async (): Promise<IpcResult<RepositorySummary[]>> => {
      try {
        const p = await getProvider();
        return ok(await p.listRepositories());
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsList,
    async (
      _e,
      repositoryName: string,
      filter: ListPRsFilter,
    ): Promise<IpcResult<PullRequestSummary[]>> => {
      try {
        if (!repositoryName) throw new Error('repositoryName is required');
        const p = await getProvider();
        return ok(await p.listPullRequests(repositoryName, filter));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsGet,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<PullRequestDetail>> => {
      try {
        const p = await getProvider();
        return ok(await p.getPullRequest(repositoryName, pullRequestId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsDifferences,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<PRDifferences>> => {
      try {
        const p = await getProvider();
        return ok(await p.getDifferences(repositoryName, pullRequestId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsFilePair,
    async (
      _e,
      repositoryName: string,
      beforeBlobId: string | undefined,
      afterBlobId: string | undefined,
    ): Promise<IpcResult<FilePair>> => {
      try {
        const p = await getProvider();
        return ok(await p.getFilePair(repositoryName, beforeBlobId, afterBlobId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- comments -------------------------------------------------------
  ipcMain.handle(
    IPC.commentsList,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<CommentThread[]>> => {
      try {
        const p = await getProvider();
        return ok(await p.listComments(repositoryName, pullRequestId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.commentsPost,
    async (
      _e,
      input: PostCommentInput,
    ): Promise<IpcResult<CommentThread>> => {
      try {
        const p = await getProvider();
        return ok(await p.postComment(input));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.commentsReply,
    async (
      _e,
      input: PostReplyInput,
    ): Promise<IpcResult<CommentThread>> => {
      try {
        const p = await getProvider();
        return ok(await p.postReply(input));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- drafts ---------------------------------------------------------
  ipcMain.handle(
    IPC.draftsList,
    async (_e, pullRequestId: string): Promise<IpcResult<CommentDraft[]>> => {
      try {
        return ok(await listDrafts(pullRequestId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.draftsSave,
    async (
      _e,
      input: {
        id?: string;
        pullRequestId: string;
        repositoryName: string;
        filePath: string;
        filePosition: number;
        relativeFileVersion: RelativeFileVersion;
        content: string;
        inReplyTo?: string;
      },
    ): Promise<IpcResult<CommentDraft>> => {
      try {
        return ok(await saveDraft(input));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.draftsDelete,
    async (_e, id: string): Promise<IpcResult<void>> => {
      try {
        await deleteDraft(id);
        return ok(undefined);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
