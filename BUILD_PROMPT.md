# Project: CodeCommit PR Review Desktop App

## Goal
Build a cross-platform (macOS + Windows) desktop app for reviewing AWS CodeCommit
pull requests locally, with a fast diff viewer and comments that sync back to CodeCommit.

## Stack (decided — do not substitute without flagging tradeoffs)
- **Electron** (consistent Chromium rendering on both OSes; proven for huge diffs)
- **React + TypeScript** in the renderer
- **Monaco diff editor** for diff rendering (this is the core of the app)
- **Node** in the main process for Git + AWS work
- **AWS SDK for JavaScript v3** (`@aws-sdk/client-codecommit`) for CodeCommit API
- **SQLite** (`better-sqlite3`) for local state/cache and draft comments
- Shell out to the system `git` binary for fetch/diff operations

## Hard requirements
1. List PRs with status filters: Open, Merged/Closed, and approval state. Sortable/filterable in UI.
2. Open a PR → fetch its source + destination branches locally → show file-by-file diff.
3. Diff viewer MUST stay smooth for very large diffs (10k–50k+ changed lines).
4. Add line-anchored comments on a PR that sync to CodeCommit (post + load existing threads + replies).
5. Use the user's existing AWS credentials (default credential chain; allow choosing a named profile + region).

## Critical architecture constraints
- **The PR/comment data source MUST sit behind an interface** (e.g. `ReviewProvider`) with a
  `CodeCommitProvider` implementation. CodeCommit is in AWS maintenance mode, so this must be
  swappable later without touching UI code.
- **Huge-diff performance is the #1 risk.** Do NOT render all diff lines as DOM nodes.
  Compute diffs in the main process, send structured data to the renderer, and rely on
  Monaco's diff editor (and/or virtualization). Lazy-load/expand per-file; don't load all
  files' full content up front. Verify scrolling stays smooth on a synthetic 50k-line diff.
- Keep heavy work (git, diff parse, AWS calls) in the main process; renderer stays responsive.
  Use IPC with clear typed channels.

## Key CodeCommit APIs to use
- `ListPullRequests` (filter by status) → enrich each with `GetPullRequest` (approval + merge state)
- `GetCommentsForPullRequest` to load existing comment threads
- `PostCommentForPullRequest` for new line-anchored comments — requires
  `pullRequestId`, `repositoryName`, `beforeCommitId`, `afterCommitId`, and a `location`
  (`filePath`, `filePosition`, `relativeFileVersion`)
- `PostCommentReply` for threading
- Map a clicked diff line → the correct `(beforeCommitId, afterCommitId, filePath, position)`
  tuple. This mapping is the fiddliest part — handle it carefully and test it.

## Build in milestones — implement and let me verify ONE at a time. Stop after each.

### M1 — Skeleton + auth + PR list (read-only)
Electron + React + TS scaffold. Connect using AWS default credential chain with a
profile/region picker. List PRs for a configured repo with the status/approval filters.
No diffs yet. **Goal: I can see and filter my real PRs.**

### M2 — Local fetch + diff viewer
On opening a PR, run `git fetch` for source + destination, compute the diff in main,
render file-by-file in Monaco. Must handle a 50k-line diff smoothly — include a way to
test this (e.g. a synthetic large diff fixture) and confirm scroll performance.

### M3 — Comments (read)
Load and display existing CodeCommit comment threads anchored to the right lines.

### M4 — Comments (write + sync)
Add new line-anchored comments and replies that post to CodeCommit. Optionally support
local draft comments in SQLite before submitting.

## Conventions
- TypeScript strict mode. Clear module boundaries. No secrets in code.
- Add a short README explaining setup, AWS credential requirements, and how to run on Mac + Windows.
- Tell me any assumption you made rather than guessing silently.

## Start now with M1 only. When it runs, I'll confirm before you proceed to M2.
