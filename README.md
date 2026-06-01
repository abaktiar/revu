# revu for CodeCommit

A fast, native-feeling desktop app for reviewing **AWS CodeCommit** pull requests
locally — built for diffs that other tools choke on.

Browse and filter PRs, read 10k–50k-line diffs without the UI stuttering, leave
line-anchored comments that sync straight back to CodeCommit, and approve or merge
without leaving the app. No local clone required — every diff and blob is read
through the CodeCommit API, so revu works on a fresh machine with nothing checked
out.

The data layer sits behind a `ReviewProvider` interface, so the same UI can later
target GitHub/GitLab/Bitbucket. CodeCommit is just the first implementation.

---

## Features

**Pull requests**
- Streaming PR list — results render as they load instead of blocking on the
  whole page, with "load more" pagination.
- Filter by status and approval state.
- Create PRs (pick source/destination branches, auto-filled title + body from the
  branch tip), edit title/description, close, and reopen.
- Approve / revoke approval, with a live approval rollup.
- Mergeability check + one-click merge (fast-forward, squash, or three-way).
  Merges are **pinned to the exact source commit you reviewed**, so a branch that
  moves mid-review can never sneak unreviewed code into the merge.

**Diff viewing**
- Custom continuous diff renderer (GitHub-style) tuned for huge diffs: per-file
  and per-hunk lazy mounting via `IntersectionObserver`, auto-collapse of very
  large files, and expand-context to pull in surrounding lines on demand.
- Per-commit diff view — drill into a single commit's changes (parent → commit)
  from the file sidebar.
- VS Code-style file sidebar with a **tree / flat-list toggle** and
  single-child folder compaction.
- Fuzzy file finder (`Cmd/Ctrl+P`) for jumping to a file in large PRs.
- Per-file **reviewed** tracking that's aware of the commit it was reviewed at.
- Syntax highlighting and GitHub-flavoured Markdown in descriptions and comments.

**Comments**
- Line-anchored comments and threaded replies, synced to CodeCommit.
- Local drafts that persist between sessions until you post them.
- Soft-delete your own comments (author-only, enforced both client- and
  server-side).

**Workflow**
- Repository switcher in the topbar (favorites float to the top) — change repos
  without opening Settings.
- Light / dark / system theme.
- Keyboard-driven navigation (see below).

---

## Requirements

- **Node 20+**
- **macOS or Windows** (Linux AppImage builds are produced too)
- **AWS credentials** with CodeCommit read access (plus write for commenting,
  approving, and merging). See [AWS credentials](#aws-credentials).

No local `git` binary or repository checkout is needed.

---

## Quick start

```bash
npm install
npm run dev
```

This launches Electron in dev mode with the renderer hot-reloading. On first run,
open **Settings** to pick an AWS profile (or paste access keys), choose a region,
and select a CodeCommit repository.

---

## AWS credentials

revu uses the **AWS SDK default credential chain**, so anything that already works
with the AWS CLI works here. You can:

- **Select a named profile** from `~/.aws/credentials` / `~/.aws/config`, or
- **Paste access keys** directly — these are encrypted at rest using the OS
  keychain (Electron `safeStorage`) and never travel back to the renderer.

Credentials are never written to source. Your profile, region, repository, and
favorites persist as JSON in Electron's `userData` directory. Caller identity is
resolved via STS so revu knows which approvals/comments are yours.

---

## Keyboard shortcuts

Press `?` anywhere to see the in-app cheat sheet.

**PR list**

| Key             | Action            |
| --------------- | ----------------- |
| `j` / `↓`       | Next PR           |
| `k` / `↑`       | Previous PR       |
| `Home` / `End`  | First / last PR   |
| `Enter`         | Open PR           |
| `Cmd/Ctrl + N`  | New pull request  |
| `/`             | Focus filter      |
| `Esc`           | Clear filter      |

**Diff view**

| Key             | Action                              |
| --------------- | ----------------------------------- |
| `j` / `k`       | Next / previous file                |
| `Cmd/Ctrl + P`  | Fuzzy file finder                   |
| `Esc`           | Back to PR diff (from a commit view)|

**Comment composer**

| Key                 | Action        |
| ------------------- | ------------- |
| `Cmd/Ctrl + Enter`  | Post comment  |
| `Esc`               | Close         |

Shortcuts are suppressed while you're typing in an input, textarea, or select.

---

## Project layout

Everything lives at the repo root — no nested project folder.

```
src/
├── main/                 # Electron main process
│   ├── index.ts          #   app bootstrap, window, menu, auto-update
│   ├── ipc.ts            #   typed IPC handlers
│   ├── settings.ts       #   AppSettings + manual keys (encrypted via safeStorage)
│   ├── drafts.ts         #   local comment drafts (JSON)
│   ├── reviewed.ts       #   per-file reviewed state (JSON)
│   ├── branchPrefs.ts    #   per-repo branch favorites (JSON)
│   ├── aws/              #   profile enumeration
│   ├── cache/            #   generic JSON key-value cache + cache keys
│   ├── diff/             #   diff computation from blob bytes + blob cache
│   └── providers/        #   ReviewProvider interface + CodeCommitProvider
├── preload/              # contextBridge — the typed API exposed to the renderer
├── renderer/             # React + TypeScript UI
│   └── components/
│       └── ContinuousDiff/  # the huge-diff renderer (the core of the app)
└── shared/               # types shared across processes
```

---

## Architecture

A few deliberate choices worth knowing before changing things (the durable rules
live in [`CLAUDE.md`](./CLAUDE.md)):

- **Provider abstraction.** All PR + comment data flows through `ReviewProvider`
  (`src/main/providers/ReviewProvider.ts`). The renderer **never** imports the AWS
  SDK — it only calls the typed API exposed over the preload bridge (`prs`,
  `comments`, `drafts`, `reviewed`, `mergeability`, `approval`, `repos`,
  `branches`, `branchPrefs`, `aws`, `creds`, `cache`, `settings`). This keeps a
  future provider swap contained.
- **Heavy work stays in the main process.** AWS calls and diff computation run in
  main; only structured hunk data (changed lines + context, not whole files) is
  sent to the renderer, which stays responsive.
- **Huge-diff performance is the #1 design constraint.** The continuous renderer
  never mounts every diff line up front — it lazy-mounts per file and per hunk and
  auto-collapses very large files, so a 50k-line diff still scrolls smoothly.
- **No local git.** Diffs come from the CodeCommit API
  (`GetDifferences`, `GetBlob`, `BatchGetCommits`) and are computed in main from
  blob bytes.
- **JSON storage**, not a database — small, bounded payloads under `userData`,
  with a `getCached`/`putCached`/`invalidate*` shape that's swappable if the
  working set ever outgrows it.

---

## Scripts

| Script               | What it does                                              |
| -------------------- | -------------------------------------------------------- |
| `npm run dev`        | Run Electron with hot reload                             |
| `npm run build`      | Production build of main + preload + renderer into `out/`|
| `npm run start`      | Preview a production build (`electron-vite preview`)     |
| `npm run typecheck`  | Strict TS check for both the node and web sides          |
| `npm run dist`       | Build + package installers for the current OS            |
| `npm run dist:mac`   | Build + package macOS `.dmg` + `.zip`                    |
| `npm run dist:win`   | Build + package the Windows NSIS installer              |
| `npm run dist:dir`   | Build an unpacked app dir (fast, for smoke-testing)      |

---

## Packaging & auto-update

Installers are produced by [`electron-builder`](https://www.electron.build/);
config lives in [`electron-builder.yml`](./electron-builder.yml). Output lands in
`release/`. Targets: macOS `dmg` + `zip`, Windows `nsis`, Linux `AppImage`.

```bash
npm run dist        # installers for the OS you're on
npm run dist:dir    # unpacked app, fastest way to sanity-check a build
```

Auto-update uses [`electron-updater`](https://www.electron.build/auto-update). On
launch, a **packaged** build checks the release feed configured under `publish:`
in `electron-builder.yml` (GitHub releases by default — point `owner`/`repo` at
your fork), downloads any newer version in the background, and notifies the user
when it's ready. The check is a no-op in `npm run dev`.

To publish a release, build with a `GH_TOKEN` in the environment:

```bash
GH_TOKEN=… npx electron-builder --publish always
```

**Code-signing is not configured** (`mac.identity` is `null`). Add a signing
identity / certificate in `electron-builder.yml` before distributing outside your
own machines.

---

## Development notes

- **Strict TypeScript** everywhere. Run `npm run typecheck` before committing;
  both the node and web projects must pass.
- **Synthetic huge-diff harness.** A dev-only fixture
  (`src/renderer/syntheticDiff.ts`) generates a ~50k-line file so the renderer's
  scroll performance can be regression-tested without a real giant PR. It's wired
  to a dev-only shortcut (`Cmd/Ctrl+Shift+D`) and is inert in production builds.

---

## Related docs

- [`PRODUCT.md`](./PRODUCT.md) — strategic design context: users, register, brand
  personality, design principles. Read before making UI decisions.
- [`DESIGN.md`](./DESIGN.md) — the visual system: colors, typography, spacing,
  component tokens.
- [`CLAUDE.md`](./CLAUDE.md) — durable architecture rules and project context.
- [`BUILD_PROMPT.md`](./BUILD_PROMPT.md) — the milestone build plan (kept for history).

---

## License

UNLICENSED — private project.
