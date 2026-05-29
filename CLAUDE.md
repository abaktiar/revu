# CLAUDE.md — Project Context

This file is read automatically by Claude Code. It holds the durable rules and
context for this project so they persist across sessions. Read it before making
architectural decisions.

## What this project is
A cross-platform (macOS + Windows) desktop app for reviewing AWS CodeCommit
pull requests locally: list/filter PRs, view large diffs fast, and add
line-anchored comments that sync back to CodeCommit.

## Stack (locked — flag tradeoffs before changing)
- **Electron** — chosen for consistent Chromium rendering on both OSes and proven
  ability to render very large diffs (VS Code is the existence proof).
- **React + TypeScript** (strict mode) in the renderer.
- **Custom continuous diff renderer** (`src/renderer/components/ContinuousDiff/`) —
  the core of the app. The product *is* a diff viewer. A GitHub-style continuous
  hunk view with lazy per-file + per-hunk mounting (IntersectionObserver),
  auto-collapse of large files, and expand-context. **Monaco was the original
  plan but was dropped** — the continuous view fits PR review better and the
  per-hunk lazy mount gives us the huge-diff performance without Monaco's weight.
  If you reintroduce Monaco, flag it: it is no longer a dependency.
- **Node** in the main process for AWS work.
- **AWS SDK for JavaScript v3** (`@aws-sdk/client-codecommit`).
- **JSON files** under Electron `userData` for local cache, drafts, reviewed-state,
  and settings (`src/main/cache/jsonCache.ts`, `drafts.ts`, `reviewed.ts`,
  `settings.ts`). **SQLite (`better-sqlite3`) was the original plan but was dropped**
  — payloads are small/bounded and we avoid a native build step in CI. The
  `getCached`/`putCached`/`invalidate*` shape is SQLite-swappable if the working
  set ever outgrows JSON.
- **No local `git` binary / no local clone.** All diff + blob data comes from the
  CodeCommit API (`GetDifferences`, `GetBlob`, `BatchGetCommits`). This was a
  deliberate change from the original "shell out to git" plan: it means the app
  works on a fresh machine with no repo checked out. Diffs are computed in the
  main process from blob bytes via the `diff` library (`computeFileDiff.ts`).

## Non-negotiable architecture rules

### 1. Provider abstraction
The PR + comment data source MUST live behind an interface (`ReviewProvider`), with
`CodeCommitProvider` as the first implementation. CodeCommit is in AWS maintenance mode
(no new customers since 2024), so the team may migrate to GitHub/GitLab/Bitbucket later.
UI and app logic must NEVER import the CodeCommit SDK directly — only through the provider.

### 2. Huge-diff performance is the #1 risk
- Target: 10k–50k+ changed lines must scroll smoothly.
- NEVER render all diff lines as DOM nodes up front. The continuous renderer
  lazy-mounts per file (IntersectionObserver + dwell) and per hunk, and
  auto-collapses files above ~500 rendered lines so a single huge file is opt-in.
  If you ever need a *single* contiguous multi-thousand-line hunk to scroll
  smoothly, that path still renders all its rows once mounted — add intra-hunk
  virtualization there rather than removing the auto-collapse valve.
- Diff computation happens in the **main process**; structured hunk data is sent
  to the renderer (only changed lines + context, not whole files).
- Lazy-load per file. Do NOT load all files' full content up front.
- A synthetic large-diff fixture lives in `src/renderer/syntheticDiff.ts`; keep it
  wired to a dev-only entry point so huge-diff scroll can be regression-tested.

### 3. Process discipline
Heavy work (git, diff parsing, AWS calls) stays in the main process. The renderer must
stay responsive. Use clear, typed IPC channels.

## CodeCommit API notes
- `ListPullRequests` (filter by status) + `GetPullRequest` (approval + merge state) for the list.
- `GetCommentsForPullRequest` to read threads.
- `PostCommentForPullRequest` needs `pullRequestId`, `repositoryName`, `beforeCommitId`,
  `afterCommitId`, and a `location` (`filePath`, `filePosition`, `relativeFileVersion`).
- `PostCommentReply` for threading.
- The diff-line → `(beforeCommitId, afterCommitId, filePath, position)` mapping is the
  fiddliest part of the app. Treat it carefully and test it.

## Auth
Use the AWS default credential chain. Allow selecting a named profile + region.
Never hardcode or commit credentials.

## Working style
- Build in milestones (M1–M4 in BUILD_PROMPT.md). Implement one at a time and stop for verification.
- State assumptions explicitly instead of guessing silently.
- Keep module boundaries clean so the provider swap stays contained.

## Design context
- Strategic design context (register, users, brand personality, anti-references,
  design principles, accessibility) lives in `PRODUCT.md` at the project root.
- Visual system (colors, typography, component tokens) will live in `DESIGN.md`
  at the project root once generated.
- Both are maintained via the `/impeccable` skill. Read PRODUCT.md before making
  UI decisions; it overrides defaults from training data.

## Git commits
- **Never** add a `Co-Authored-By: Claude …` trailer (or any Claude/Anthropic
  attribution) to commit messages on this project. Author commits as if written
  solely by the user.
