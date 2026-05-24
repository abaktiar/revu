# revu

Desktop app for reviewing AWS CodeCommit pull requests locally. Fast diff viewer,
line-anchored comments synced back to CodeCommit, swappable provider so we can
move off CodeCommit later.

> Status: **M1 — read-only PR list.** Diff viewer and comments come in M2–M4.

## Requirements

- Node 20+
- macOS or Windows
- The `git` binary on PATH (used in M2 for fetch/diff)
- AWS credentials configured locally (`~/.aws/credentials` and/or `~/.aws/config`).
  The default credential chain is used; you can pick a named profile from the UI.

## Setup

```bash
npm install
npm run dev
```

This launches Electron in dev mode with the renderer hot-reloading. The first
window asks you to pick an AWS profile, region, and CodeCommit repository name.

## Project layout

Everything lives at the repo root — no nested project folder.

```
src/
├── main/         # Electron main process: AWS calls, git, IPC handlers
│   └── providers/  # ReviewProvider interface + CodeCommitProvider
├── preload/      # contextBridge — the typed API exposed to the renderer
├── renderer/     # React + TS UI
└── shared/       # Types shared across processes
```

## AWS credentials

The app uses the AWS SDK default credential chain plus an optional named
profile selected in the UI. Nothing is stored in code. Profile + region +
repository selections persist in Electron's `userData` directory as JSON.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run Electron with hot reload |
| `npm run build` | Production build of main + preload + renderer into `out/` |
| `npm run typecheck` | Strict TS check for both node and web sides |

## Provider abstraction

PR + comment data flows through `ReviewProvider` (`src/main/providers/ReviewProvider.ts`).
`CodeCommitProvider` is the first implementation. Renderer code never imports
the AWS SDK — only the typed IPC API exposed via the preload bridge.
