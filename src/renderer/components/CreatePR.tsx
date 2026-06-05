import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CommentDraft,
  CommentThread,
  FileDiffEntry,
  PRDifferences,
  PullRequestSummary,
  RelativeFileVersion,
  RepoBranchPrefs,
} from '@shared/types';
import { api, unwrap } from '../api';
import { BranchPicker } from './BranchPicker';
import { FileSidebar } from './FileSidebar';
import {
  ContinuousDiff,
  type ContinuousDiffHandle,
} from './ContinuousDiff/ContinuousDiff';
import type { DiffCallbacks, DiffContext } from './ContinuousDiff/types';
import { ArrowLeft, ArrowRight } from '../icons';
import { ErrorBanner } from './ErrorBanner';

interface Props {
  repositoryName: string;
  // The currently-loaded PR list (used only for the "open PR for this
  // source→dest pair already exists" warning — a soft UX check, not a hard
  // server guarantee). Pass [] if the list isn't populated.
  openPullRequests: readonly PullRequestSummary[];
  onCancel: () => void;
  onCreated: (pr: PullRequestSummary) => void;
}

// Stable empty refs so memoized ContinuousDiff children don't see fresh
// references every render.
const EMPTY_THREADS: CommentThread[] = [];
const EMPTY_DRAFTS: CommentDraft[] = [];
const EMPTY_PATHS: Set<string> = new Set();

const TITLE_MAX = 150; // CodeCommit accepts ~150 chars before truncation
const DESC_MAX = 10240; // generous; AWS limit is 10240

export function CreatePR({
  repositoryName,
  openPullRequests,
  onCancel,
  onCreated,
}: Props): JSX.Element {
  const [prefs, setPrefs] = useState<RepoBranchPrefs | null>(null);

  // Form state. The user can edit each field independently; we never
  // overwrite a field once it has been edited (tracked via touched flags).
  const [source, setSource] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Track whether the user has touched each autofilled field. Once touched,
  // we stop overwriting it from the branch tip lookup. Without this guard a
  // user who types a title and then switches source branches would lose
  // their work.
  const [titleTouched, setTitleTouched] = useState(false);
  const [descTouched, setDescTouched] = useState(false);

  // Diff preview. Loads when both source and dest are picked and differ.
  const [diff, setDiff] = useState<PRDifferences | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<unknown>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  // Bumped by the diff-preview "Retry" button. The diff effect lists this in
  // its deps so a bump re-runs the fetch even when source/destination
  // haven't changed.
  const [diffRefreshToken, setDiffRefreshToken] = useState(0);

  // Submit state. Becomes 'submitting' while AWS is processing CreatePullRequest.
  const [submitState, setSubmitState] = useState<
    'idle' | 'submitting' | 'error'
  >('idle');
  const [submitError, setSubmitError] = useState<unknown>(null);

  const diffRef = useRef<ContinuousDiffHandle | null>(null);

  // ---- Load per-repo prefs once on mount ------------------------------
  useEffect(() => {
    let cancelled = false;
    unwrap(api.branchPrefs.get(repositoryName))
      .then((p) => {
        if (cancelled) return;
        setPrefs(p);
        // Apply pre-fills only at first paint. The user can override either
        // value freely from here on; we never re-apply when prefs reload.
        if (p.lastSourceBranch) setSource(p.lastSourceBranch);
        if (p.favoriteDestinations.length === 1) {
          // Exactly one favorite → auto-pick it. Multiple → user picks.
          setDestination(p.favoriteDestinations[0] ?? null);
        }
      })
      .catch(() => {
        // Prefs are not critical — if the file is missing or unreadable we
        // just start with empty defaults.
        if (!cancelled) {
          setPrefs({ repositoryName, favoriteDestinations: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryName]);

  // ---- Title autofill from source branch tip --------------------------
  // Once the user picks a source we read its tip commit subject + body and
  // pre-fill title / description. Only if the user hasn't already touched
  // those fields manually.
  useEffect(() => {
    if (!source) return;
    if (titleTouched && descTouched) return;
    let cancelled = false;
    unwrap(api.branches.tip(repositoryName, source))
      .then((tip) => {
        if (cancelled) return;
        if (!titleTouched) {
          setTitle(tip.subject.slice(0, TITLE_MAX));
        }
        if (!descTouched && tip.body) {
          setDescription(tip.body.slice(0, DESC_MAX));
        }
      })
      .catch(() => {
        // Autofill is best-effort. If GetBranch/GetCommit fails (permission,
        // network), the user can type the title themselves; no banner.
      });
    return () => {
      cancelled = true;
    };
  }, [source, repositoryName, titleTouched, descTouched]);

  // ---- Diff preview ---------------------------------------------------
  useEffect(() => {
    if (!source || !destination) {
      setDiff(null);
      setDiffError(null);
      setActiveFile(null);
      return;
    }
    if (source === destination) {
      // Same branch can't have a diff — and validation already blocks
      // submit in this case. Clear any stale diff state.
      setDiff(null);
      setDiffError(null);
      setActiveFile(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    setActiveFile(null);
    const forceFresh = diffRefreshToken > 0;
    unwrap(
      api.prs.refDifferences(
        repositoryName,
        source,
        destination,
        forceFresh ? { forceFresh: true } : undefined,
      ),
    )
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDiffError(err);
      })
      .finally(() => {
        if (cancelled) return;
        setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, destination, repositoryName, diffRefreshToken]);

  const toggleFavorite = useCallback(
    async (branchName: string, favorite: boolean): Promise<void> => {
      try {
        const next = await unwrap(
          api.branchPrefs.toggleFavorite(repositoryName, branchName, favorite),
        );
        setPrefs(next);
      } catch (err) {
        // Swallow — favorites are non-critical local state. Log so a future
        // user can diagnose via devtools.
        console.error('[CreatePR] toggleFavorite failed:', err);
      }
    },
    [repositoryName],
  );

  // ---- Validation -----------------------------------------------------
  // These derived values drive the inline error chips and the Raise PR
  // button's disabled state.
  const trimmedTitle = title.trim();
  const sameBranches =
    !!source && !!destination && source === destination;
  const noTitle = trimmedTitle.length === 0;
  const noCommits = !!diff && diff.files.length === 0 && !diffLoading && !sameBranches;
  const duplicatePr = useMemo<PullRequestSummary | null>(() => {
    if (!source || !destination) return null;
    if (sameBranches) return null;
    return (
      openPullRequests.find((pr) => {
        if (pr.status !== 'OPEN') return false;
        const t = pr.targets.find(
          (tg) =>
            tg.repositoryName.toLowerCase() === repositoryName.toLowerCase(),
        );
        if (!t) return false;
        return (
          stripRefHeads(t.sourceReference) === source &&
          stripRefHeads(t.destinationReference) === destination
        );
      }) ?? null
    );
  }, [openPullRequests, source, destination, sameBranches, repositoryName]);

  const canSubmit =
    !!source &&
    !!destination &&
    !sameBranches &&
    !noTitle &&
    !noCommits &&
    !duplicatePr &&
    submitState !== 'submitting' &&
    !diffLoading;

  // ---- Submit ---------------------------------------------------------
  const submit = useCallback(async (): Promise<void> => {
    if (!canSubmit || !source || !destination) return;
    setSubmitState('submitting');
    setSubmitError(null);
    try {
      const created = await unwrap(
        api.prs.create({
          repositoryName,
          title: trimmedTitle,
          description: description.trim() || undefined,
          sourceReference: source,
          destinationReference: destination,
        }),
      );
      // Persist the source branch so the next Create-PR opens with it
      // pre-filled. Best-effort — failure here doesn't block the navigation.
      try {
        await unwrap(api.branchPrefs.setLastSource(repositoryName, source));
      } catch (err) {
        console.error('[CreatePR] setLastSource failed:', err);
      }
      onCreated(created);
    } catch (err) {
      setSubmitState('error');
      setSubmitError(err);
    }
  }, [
    canSubmit,
    source,
    destination,
    trimmedTitle,
    description,
    repositoryName,
    onCreated,
  ]);

  // ---- ContinuousDiff plumbing — readonly diff -----------------------
  const ctx: DiffContext | null = useMemo(() => {
    if (!diff) return null;
    return {
      pullRequestId: '',
      repositoryName,
      beforeCommitId: diff.beforeCommitId,
      afterCommitId: diff.afterCommitId,
      postingThreadId: null,
      readOnly: true,
    };
  }, [diff, repositoryName]);

  const callbacks: DiffCallbacks = useMemo(
    () => ({
      onPostComment: noopAsync,
      onPostReply: noopAsync,
      onSaveDraft: noopAsync,
      onDeleteDraft: noopAsync,
      onDeleteComment: noopAsync,
      onToggleReviewed: noop,
    }),
    [],
  );

  const onActiveFileChange = useCallback((path: string | null): void => {
    setActiveFile(path);
  }, []);

  const onSidebarSelect = useCallback((file: FileDiffEntry): void => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    diffRef.current?.scrollToFile(file.path, {
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
    });
  }, []);

  // Esc cancels the flow when focus isn't in a text field.
  useEffect(() => {
    function onKey(ev: KeyboardEvent): void {
      if (ev.key !== 'Escape') return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      ev.preventDefault();
      onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const titleHint = (() => {
    if (noTitle) return 'Title is required.';
    if (title.length > TITLE_MAX) return `Max ${TITLE_MAX} characters.`;
    return null;
  })();

  return (
    <div className="pr-detail create-pr">
      <div className="pr-toolbar">
        <button type="button" onClick={onCancel}>
          <ArrowLeft size={12} />
          Cancel
        </button>
        <span className="pr-title">New pull request</span>
        <span className="grow" />
        {submitState === 'submitting' && (
          <span className="hint">Creating PR…</span>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => void submit()}
          disabled={!canSubmit}
          title={submitDisabledHint({
            source,
            destination,
            sameBranches,
            noTitle,
            noCommits,
            duplicatePr: !!duplicatePr,
            diffLoading,
          })}
        >
          {submitState === 'submitting' ? 'Raising…' : 'Raise PR'}
        </button>
      </div>

      <div className="create-pr-form">
        <div className="create-pr-row">
          <label className="create-pr-label">
            Source
            <BranchPicker
              ariaLabel="Source branch"
              placeholder="Pick the source branch"
              repositoryName={repositoryName}
              value={source}
              onChange={(name) => {
                setSource(name);
                // Reset the autofill touched flags so the new branch's
                // subject/body populates again. We don't clear what the user
                // typed; the autofill effect already respects touched.
                // (Intentionally leaving titleTouched/descTouched as-is.)
              }}
            />
          </label>

          <span className="create-pr-arrow" aria-hidden="true">
            <ArrowRight size={14} />
          </span>

          <label className="create-pr-label">
            Destination
            <BranchPicker
              ariaLabel="Destination branch"
              placeholder="Pick the destination branch"
              repositoryName={repositoryName}
              value={destination}
              onChange={setDestination}
              favoriteDestinations={prefs?.favoriteDestinations ?? []}
              onToggleFavorite={(name, fav) => void toggleFavorite(name, fav)}
            />
          </label>
        </div>

        <label className="create-pr-label create-pr-title-label">
          Title
          <input
            type="text"
            value={title}
            placeholder="One-line summary of the change"
            maxLength={TITLE_MAX}
            onChange={(ev) => {
              setTitle(ev.target.value);
              setTitleTouched(true);
            }}
            onBlur={() => setTitleTouched(true)}
            aria-invalid={!!titleHint}
            className="create-pr-title-input"
          />
          {titleHint && (
            <span className="create-pr-field-hint create-pr-field-hint-error">
              {titleHint}
            </span>
          )}
        </label>

        <label className="create-pr-label">
          Description
          <textarea
            value={description}
            placeholder="What does this change do? Markdown is supported."
            rows={4}
            maxLength={DESC_MAX}
            onChange={(ev) => {
              setDescription(ev.target.value);
              setDescTouched(true);
            }}
            onBlur={() => setDescTouched(true)}
            className="create-pr-description-input"
          />
        </label>

        {/* Validation chips — visible below the form. These mirror the
            submit button's disabled state in human-readable form. */}
        {(sameBranches || duplicatePr || noCommits) && (
          <div className="create-pr-validation">
            {sameBranches && (
              <span className="create-pr-validation-item is-error">
                Source and destination must differ.
              </span>
            )}
            {!sameBranches && noCommits && (
              <span className="create-pr-validation-item is-error">
                No commits between these branches — nothing to merge.
              </span>
            )}
            {duplicatePr && (
              <span className="create-pr-validation-item is-warn">
                A pull request for this source → destination is already open:
                {' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onCreated(duplicatePr)}
                >
                  #{duplicatePr.id} {duplicatePr.title}
                </button>
              </span>
            )}
          </div>
        )}

        {submitState === 'error' && submitError ? (
          <ErrorBanner
            title="Could not create the pull request."
            error={submitError}
            onRetry={() => void submit()}
            retryLabel="Retry"
            retrying={false}
          />
        ) : null}
      </div>

      <div className="pr-body">
        <FileSidebar
          tab="files"
          onChangeTab={noop}
          files={diff?.files ?? []}
          selectedPath={activeFile ?? undefined}
          commentCounts={{}}
          reviewedPaths={EMPTY_PATHS}
          onSelect={onSidebarSelect}
          onToggleReviewed={noop}
          filesReadOnly
        />
        <div className="diff-area">
          {diffError ? (
            <ErrorBanner
              title="Could not load the diff for these branches."
              error={diffError}
              onRetry={() => setDiffRefreshToken((n) => n + 1)}
              retryLabel="Retry"
              retrying={diffLoading}
            />
          ) : !source || !destination ? (
            <div className="empty">
              Pick a source and destination branch to preview the diff.
            </div>
          ) : sameBranches ? (
            <div className="empty">
              Source and destination are the same branch.
            </div>
          ) : diffLoading ? (
            <div className="loading">Loading diff…</div>
          ) : !diff || diff.files.length === 0 || !ctx ? (
            <div className="empty">No files changed between these branches.</div>
          ) : (
            <ContinuousDiff
              ref={diffRef}
              files={diff.files}
              threads={EMPTY_THREADS}
              drafts={EMPTY_DRAFTS}
              reviewedPaths={EMPTY_PATHS}
              ctx={ctx}
              callbacks={callbacks}
              onActiveFileChange={onActiveFileChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// CodeCommit returns branch references either as plain names ("main") or as
// fully-qualified refs ("refs/heads/main"). Normalize to the plain name so
// our string equality check works across both shapes.
function stripRefHeads(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

function submitDisabledHint(args: {
  source: string | null;
  destination: string | null;
  sameBranches: boolean;
  noTitle: boolean;
  noCommits: boolean;
  duplicatePr: boolean;
  diffLoading: boolean;
}): string | undefined {
  if (!args.source) return 'Pick a source branch.';
  if (!args.destination) return 'Pick a destination branch.';
  if (args.sameBranches) return 'Source and destination must differ.';
  if (args.diffLoading) return 'Loading diff…';
  if (args.noCommits) return 'No commits between these branches.';
  if (args.noTitle) return 'Title is required.';
  if (args.duplicatePr) return 'A PR for this source → destination is already open.';
  return undefined;
}

const noop = (): void => undefined;
const noopAsync = async (): Promise<void> => undefined;
