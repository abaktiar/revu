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
- **Monaco diff editor** — the core of the app. The product *is* a diff viewer.
- **Node** in the main process for Git + AWS work.
- **AWS SDK for JavaScript v3** (`@aws-sdk/client-codecommit`).
- **SQLite** (`better-sqlite3`) for local cache and draft comments.
- System `git` binary (subprocess) for fetch/diff.

## Non-negotiable architecture rules

### 1. Provider abstraction
The PR + comment data source MUST live behind an interface (`ReviewProvider`), with
`CodeCommitProvider` as the first implementation. CodeCommit is in AWS maintenance mode
(no new customers since 2024), so the team may migrate to GitHub/GitLab/Bitbucket later.
UI and app logic must NEVER import the CodeCommit SDK directly — only through the provider.

### 2. Huge-diff performance is the #1 risk
- Target: 10k–50k+ changed lines must scroll smoothly.
- NEVER render all diff lines as DOM nodes. Use Monaco's diff editor and/or virtualization.
- Diff computation happens in the **main process**; structured data is sent to the renderer.
- Lazy-load per file. Do NOT load all files' full content up front.
- Keep a synthetic large-diff fixture around to regression-test performance.

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
