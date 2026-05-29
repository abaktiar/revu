# revu

Desktop app for reviewing AWS CodeCommit pull requests locally. Fast diff viewer,
line-anchored comments synced back to CodeCommit, swappable provider so we can
move off CodeCommit later.

> Status: **feature-complete for CodeCommit.** Streaming PR list with filters,
> continuous diff viewer (huge-diff friendly), line-anchored comments + replies +
> drafts, approvals, mergeability + merge, PR create/edit/close, per-commit diffs,
> reviewed-file tracking, a file tree + fuzzy finder, and a repo switcher.

## Requirements

- Node 20+
- macOS or Windows
- AWS credentials configured locally (`~/.aws/credentials` and/or `~/.aws/config`),
  or pasted access keys (stored encrypted via the OS keychain). The default
  credential chain is used; you can pick a named profile from the UI.

No local `git` binary or repo checkout is needed — all diff and blob data is read
through the CodeCommit API.

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
├── main/         # Electron main process: AWS calls, diff compute, IPC handlers
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
| `npm run dist` | Build + package installers for the current OS into `release/` |
| `npm run dist:mac` | Build + package macOS `.dmg` + `.zip` |
| `npm run dist:win` | Build + package the Windows NSIS installer |
| `npm run dist:dir` | Build an unpacked app directory (fast, for smoke-testing) |

## Packaging & auto-update

Installers are produced by [`electron-builder`](https://www.electron.build/);
config lives in `electron-builder.yml`. Output lands in `release/`.

```bash
npm run dist        # installers for the OS you're on
npm run dist:dir    # unpacked app, fastest way to sanity-check a build
```

Auto-update uses [`electron-updater`](https://www.electron.build/auto-update).
On launch, a packaged build checks the release feed configured under `publish:`
in `electron-builder.yml` (GitHub releases by default — point `owner`/`repo` at
your fork), downloads any newer version in the background, and notifies the user
when it's ready to install. The check is a no-op in `npm run dev`.

To publish a release, build with a `GH_TOKEN` in the environment:

```bash
GH_TOKEN=… npx electron-builder --publish always
```

Code-signing is not configured; add `mac.identity` / Windows signing certs in
`electron-builder.yml` before distributing outside your own machines.

## Provider abstraction

PR + comment data flows through `ReviewProvider` (`src/main/providers/ReviewProvider.ts`).
`CodeCommitProvider` is the first implementation. Renderer code never imports
the AWS SDK — only the typed IPC API exposed via the preload bridge.
