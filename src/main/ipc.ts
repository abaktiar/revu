import { ipcMain } from 'electron';
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
  PullRequestCommit,
  PullRequestDetail,
  PullRequestMergeability,
  RelativeFileVersion,
  RepositorySummary,
  ReviewedFile,
} from '@shared/types';
import { CodeCommitProvider, ProviderError } from './providers/CodeCommitProvider';
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
import { listReviewed, setReviewed } from './reviewed';
import { clearAllCaches } from './cache/jsonCache';

export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  credsSave: 'creds:save',
  credsClear: 'creds:clear',
  awsListProfiles: 'aws:list-profiles',
  reposList: 'repos:list',
  // Streaming PR-list session: start kicks off enrichment, item/done/error
  // events flow back via webContents.send, cancel aborts cooperatively.
  prsListStart: 'prs:list-start',
  prsListCancel: 'prs:list-cancel',
  prsListItem: 'prs:list-item',
  prsListDone: 'prs:list-done',
  prsListError: 'prs:list-error',
  prsGet: 'prs:get',
  prsDifferences: 'prs:differences',
  prsCommitDifferences: 'prs:commit-differences',
  prsCommits: 'prs:commits',
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

let provider: ReviewProvider | null = null;
let providerKey = '';

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function fail<T = never>(err: unknown): IpcResult<T> {
  // ProviderError already carries a classified code + actionable hint; pass
  // them through so the renderer can show real error UI instead of a raw
  // exception string. Anything else (settings load errors, draft DB errors,
  // unexpected throws) is reported as 'unknown' with no hint.
  if (err instanceof ProviderError) {
    return {
      ok: false,
      error: err.message,
      errorCode: err.code,
      errorHint: err.hint,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message, errorCode: 'unknown' };
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
    throw new ProviderError({
      message:
        'Credential source is "keys" but no access keys are saved.',
      code: 'credentials_missing',
      hint: 'Open Settings and paste your AWS environment-variable block (the one that starts with `export AWS_ACCESS_KEY_ID=…`).',
    });
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
    async (_e, opts?: { forceFresh?: boolean }): Promise<
      IpcResult<RepositorySummary[]>
    > => {
      try {
        const p = await getProvider();
        return ok(await p.listRepositories(opts));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // Map from sessionId → AbortController for the streaming PR-list sessions.
  // Lifecycle: created in prs:list-start, removed when the stream finishes
  // (success, error, or abort). Multiple sessions can be in flight at once;
  // the renderer guarantees they have distinct sessionIds.
  const listSessions = new Map<string, AbortController>();

  ipcMain.handle(
    IPC.prsListStart,
    async (
      e,
      payload: {
        sessionId: string;
        repositoryName: string;
        filter: ListPRsFilter;
        forceFresh?: boolean;
      },
    ): Promise<IpcResult<void>> => {
      try {
        const { sessionId, repositoryName, filter, forceFresh } = payload;
        if (!sessionId) throw new Error('sessionId is required');
        if (!repositoryName) throw new Error('repositoryName is required');
        if (listSessions.has(sessionId)) {
          throw new Error(`sessionId ${sessionId} is already in use`);
        }
        const p = await getProvider();
        const ac = new AbortController();
        listSessions.set(sessionId, ac);
        const wc = e.sender;

        // Fire-and-forget: the stream runs in the background, pushing events
        // back via webContents.send. The renderer awaits the start ack to
        // confirm the session is registered (so a Cancel can land), then
        // listens for item/done/error events keyed by sessionId.
        void (async () => {
          try {
            const result = await p.streamPullRequests(repositoryName, filter, {
              forceFresh,
              signal: ac.signal,
              onItem: ({ item, loaded, total }) => {
                if (wc.isDestroyed()) return;
                const ev: ListItemEvent = { sessionId, item, loaded, total };
                wc.send(IPC.prsListItem, ev);
              },
            });
            if (!wc.isDestroyed()) {
              const ev: ListDoneEvent = { sessionId, ...result };
              wc.send(IPC.prsListDone, ev);
            }
          } catch (err) {
            if (!wc.isDestroyed()) {
              const failed = fail(err);
              const ev: ListErrorEvent = {
                sessionId,
                error: failed.ok ? 'unknown' : failed.error,
                errorCode: failed.ok ? undefined : failed.errorCode,
                errorHint: failed.ok ? undefined : failed.errorHint,
              };
              wc.send(IPC.prsListError, ev);
            }
          } finally {
            listSessions.delete(sessionId);
          }
        })();

        return ok(undefined);
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsListCancel,
    async (_e, sessionId: string): Promise<IpcResult<void>> => {
      const ac = listSessions.get(sessionId);
      // Idempotent: cancelling an already-finished or never-started session
      // is a no-op rather than an error. The renderer can fire cancel on
      // unmount without checking session state.
      if (ac) ac.abort();
      return ok(undefined);
    },
  );

  ipcMain.handle(
    IPC.prsGet,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
      opts?: { forceFresh?: boolean },
    ): Promise<IpcResult<PullRequestDetail>> => {
      try {
        const p = await getProvider();
        return ok(await p.getPullRequest(repositoryName, pullRequestId, opts));
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
      opts?: { forceFresh?: boolean },
    ): Promise<IpcResult<PRDifferences>> => {
      try {
        const p = await getProvider();
        return ok(
          await p.getDifferences(repositoryName, pullRequestId, opts),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsCommitDifferences,
    async (
      _e,
      repositoryName: string,
      beforeCommitId: string,
      afterCommitId: string,
      opts?: { forceFresh?: boolean },
    ): Promise<IpcResult<PRDifferences>> => {
      try {
        const p = await getProvider();
        return ok(
          await p.getCommitDifferences(
            repositoryName,
            beforeCommitId,
            afterCommitId,
            opts,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsCommits,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
      opts?: { forceFresh?: boolean },
    ): Promise<IpcResult<PullRequestCommit[]>> => {
      try {
        const p = await getProvider();
        return ok(
          await p.listPullRequestCommits(repositoryName, pullRequestId, opts),
        );
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

  ipcMain.handle(
    IPC.prsFileDiff,
    async (
      _e,
      repositoryName: string,
      entry: FileDiffEntry,
      opts?: { forceFresh?: boolean },
    ): Promise<IpcResult<FileDiff>> => {
      try {
        const p = await getProvider();
        return ok(await p.getFileDiff(repositoryName, entry, opts));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsExpandLines,
    async (
      _e,
      request: ExpandLinesRequest,
    ): Promise<IpcResult<ExpandLinesResponse>> => {
      try {
        const p = await getProvider();
        return ok(await p.expandLines(request));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.prsWebUrl,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<string | undefined>> => {
      try {
        const p = await getProvider();
        return ok(await p.webUrlForPullRequest(repositoryName, pullRequestId));
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
      opts?: { forceFresh?: boolean },
    ): Promise<IpcResult<CommentThread[]>> => {
      try {
        const p = await getProvider();
        return ok(await p.listComments(repositoryName, pullRequestId, opts));
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

  ipcMain.handle(
    IPC.commentsDelete,
    async (
      _e,
      input: DeleteCommentInput,
    ): Promise<IpcResult<CommentNode>> => {
      try {
        const p = await getProvider();
        return ok(await p.deleteComment(input));
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

  // ---- approvals ------------------------------------------------------
  ipcMain.handle(
    IPC.approvalGet,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
      opts?: { forceFresh?: boolean },
    ): Promise<IpcResult<PullRequestApprovalView>> => {
      try {
        const p = await getProvider();
        return ok(
          await p.getApprovalView(repositoryName, pullRequestId, opts),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.approvalUpdate,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
      action: ApprovalAction,
    ): Promise<IpcResult<PullRequestApprovalView>> => {
      try {
        const p = await getProvider();
        return ok(
          await p.updateApprovalState(repositoryName, pullRequestId, action),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.mergeabilityGet,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
      opts?: { forceFresh?: boolean },
    ): Promise<IpcResult<PullRequestMergeability>> => {
      try {
        const p = await getProvider();
        return ok(
          await p.getMergeability(repositoryName, pullRequestId, opts),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- reviewed files -------------------------------------------------
  ipcMain.handle(
    IPC.reviewedList,
    async (_e, pullRequestId: string): Promise<IpcResult<ReviewedFile[]>> => {
      try {
        return ok(await listReviewed(pullRequestId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.reviewedToggle,
    async (
      _e,
      pullRequestId: string,
      filePath: string,
      afterCommitId: string,
      reviewed: boolean,
    ): Promise<IpcResult<ReviewedFile | null>> => {
      try {
        return ok(
          await setReviewed(pullRequestId, filePath, afterCommitId, reviewed),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- cache invalidation --------------------------------------------
  ipcMain.handle(
    IPC.cacheInvalidatePr,
    async (
      _e,
      repositoryName: string,
      pullRequestId: string,
    ): Promise<IpcResult<void>> => {
      try {
        const p = await getProvider();
        await p.invalidatePullRequest(repositoryName, pullRequestId);
        return ok(undefined);
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    IPC.cacheInvalidateRepo,
    async (_e, repositoryName: string): Promise<IpcResult<void>> => {
      try {
        const p = await getProvider();
        await p.invalidateRepository(repositoryName);
        return ok(undefined);
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(IPC.cacheClearAll, async (): Promise<IpcResult<void>> => {
    try {
      // We deliberately call the cache module directly instead of going
      // through the provider — even if no provider is configured yet (e.g.
      // misconfigured credentials), the user must still be able to wipe
      // the disk cache from Settings.
      await clearAllCaches();
      return ok(undefined);
    } catch (err) {
      return fail(err);
    }
  });
}
