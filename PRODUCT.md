# Product

## Register

product

## Users

Engineers stuck on AWS CodeCommit who have to review pull requests but don't want
to live in the CodeCommit web console to do it. Solo developers and small teams
on AWS-native stacks where CodeCommit was chosen for IAM/VPC reasons rather than
preference. They already live in a terminal and an editor; a desktop app that
feels native to their OS is welcome, a heavy browser-shaped Electron app is not.

Context of use: actively reading a real PR diff, often large (10k–50k+ changed
lines), tab-switching back and forth to write line-anchored comments and replies,
opening several PRs across a working session. The reviewer is not a casual user
and is not learning git on the job.

## Product Purpose

Make reviewing a CodeCommit PR feel as good as reviewing a PR on a tool that
people actually like — local, fast, native, line-anchored comments that sync
back to CodeCommit. The provider seam exists because CodeCommit is in AWS
maintenance mode; the day a reviewer's team moves to GitHub or GitLab, the UI
shouldn't have to change.

Success looks like: a 50k-line diff scrolls smoothly on a normal laptop; an
engineer reaches for revu instead of the AWS Console for every review; opening
the app feels like opening a native tool, not a web page in a chrome-less window.

## Brand Personality

Three words: **quiet · fast · native.**

Voice: terse, technical, no marketing tone. The reviewer knows what
`beforeCommitId` is. Don't explain git. Don't explain PRs. Don't sell the
product back to the user inside the product.

Tone: confident in the small set of things this app does, silent about
everything else. No exclamation marks. No emoji garnish in labels or copy. No
"Welcome to revu!" anywhere.

Emotional goal: the relief of being out of the CodeCommit web UI. The pleasure
of a native app that respects the host OS.

## Anti-references

Four things this should not look or feel like:

- **AWS Console.** The thing we're escaping. Generic enterprise chrome, orange
  accents, dense form layouts, slow web feel. Even the *direction* of the AWS
  Console is wrong for this app.
- **Generic Electron app (Slack-shaped).** Heavy custom chrome that fights the
  OS, non-native scrollbars, mismatched window controls, big avatars and emoji
  noise, sluggish startup. The fact that we're in Electron should be invisible.
- **SaaS dashboard cliché.** Big hero-metric tiles, gradient accents,
  decorative cards, hero-illustrated empty states, AI-generated icon sets, a
  cheerful welcome screen. revu has no marketing-shaped surfaces; don't smuggle
  one in.
- **AI-coded slop.** Glassmorphism for its own sake, gradient text, side-stripe
  borders, identical card grids, emoji in section headings, copy that restates
  the heading. If a stranger could look at a screen and say "AI made that
  without thinking," it's failed.

## Design Principles

1. **Native before novel.** Honor the host platform: macOS gets real vibrancy,
   traffic-light spacing, refined typography; Windows gets clean opaque panels
   and proper title-bar behavior. Don't invent custom chrome for its own sake.
   The shell should feel like the OS, not like a third-party UI kit.

2. **The diff is the product.** Every other surface — PR list, settings,
   sidebar, comment composer — earns its space by being out of the way when
   the reviewer is reading code. Don't compete with the diff for attention.
   Color, motion, and decoration recede inside the diff viewport.

3. **Fast is a design choice.** Smooth scrolling on 50k-line diffs,
   sub-frame interaction response, lazy file loading, pre-fetched neighbors —
   performance is visible polish, not a backend concern. A janky frame is a
   visual regression.

4. **Respect the reviewer.** Terse, technical copy. No hand-holding tooltips on
   things engineers already know. No marketing voice. Defaults that assume
   competence. Power-user affordances (keyboard nav, file filter, reviewed
   toggle) before beginner affordances.

5. **Provider-shaped, never CodeCommit-shaped.** UI copy uses neutral terms
   ("repo", "PR", "comment", "approval") where possible. CodeCommit-specific
   language only appears when the user is configuring a CodeCommit connection.
   The day a second provider ships, the diff viewer and comment UX should not
   need to change.

## Accessibility & Inclusion

- **WCAG AA baseline.** Real contrast on dim text, visible focus rings on every
  interactive element, full keyboard navigation through the PR list, file
  sidebar, diff, and comment threads. Screen-reader-friendly labels on
  icon-only controls.
- **Honor system preferences.** `prefers-reduced-motion` disables non-essential
  transitions. `prefers-reduced-transparency` is already honored on macOS
  vibrancy surfaces; keep it that way as new translucent elements land.
- **Light theme is a first-class target, not an afterthought.** Dark is the
  current default and the right default for late-night reviewing, but a real
  light theme (or system-following) is on the roadmap. Design tokens should be
  structured for theme-swap from day one, not bolted on later.
- **Never color-alone.** Diff +/− lines use both a leading mark and a tint;
  PR status badges use both a label and a color; file change types use both a
  letter (A/M/D/R) and a color. Keep this discipline as new states are added.
