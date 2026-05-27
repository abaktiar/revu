---
name: revu
description: Native-feeling desktop tool for reviewing AWS CodeCommit pull requests locally.
colors:
  bg: "#0f1115"
  panel: "#161a22"
  panel-2: "#1c2230"
  border: "#262d3c"
  control: "#212837"
  control-hover: "#273044"
  control-active: "#1a2030"
  text: "#e6e9ef"
  text-dim: "#8a93a6"
  primary-text: "#f7faff"
  accent: "#5b8def"
  accent-fade: "#2a3a5e"
  ok: "#4ade80"
  warn: "#facc15"
  bad: "#f87171"
  neutral: "#94a3b8"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.5px"
  code:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  diff-row:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
    letterSpacing: "normal"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "7px"
  xl: "8px"
  pill: "999px"
spacing:
  "1": "2px"
  "2": "4px"
  "3": "6px"
  "4": "8px"
  "5": "10px"
  "6": "12px"
  "7": "14px"
  "8": "16px"
components:
  button-default:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "5px 11px"
    height: "28px"
  button-default-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.text}"
  button-default-active:
    backgroundColor: "{colors.control-active}"
    textColor: "{colors.text}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "5px 11px"
    height: "28px"
  input:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
    height: "28px"
  segmented-button:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text-dim}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  segmented-button-active:
    backgroundColor: "{colors.accent-fade}"
    textColor: "{colors.text}"
  badge-open:
    backgroundColor: "{colors.ok}"
    textColor: "{colors.ok}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  badge-merged:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  badge-closed:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.neutral}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  change-type-added:
    backgroundColor: "{colors.ok}"
    textColor: "{colors.ok}"
    typography: "{typography.code}"
    rounded: "{rounded.xs}"
    width: "16px"
  change-type-modified:
    backgroundColor: "{colors.warn}"
    textColor: "{colors.warn}"
    typography: "{typography.code}"
    rounded: "{rounded.xs}"
    width: "16px"
  change-type-deleted:
    backgroundColor: "{colors.bad}"
    textColor: "{colors.bad}"
    typography: "{typography.code}"
    rounded: "{rounded.xs}"
    width: "16px"
  file-list-item:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "5px 8px"
  file-list-item-active:
    backgroundColor: "{colors.accent-fade}"
    textColor: "{colors.text}"
  diff-row-added:
    backgroundColor: "{colors.ok}"
    textColor: "{colors.text}"
    typography: "{typography.diff-row}"
    padding: "0 6px"
  diff-row-deleted:
    backgroundColor: "{colors.bad}"
    textColor: "{colors.text}"
    typography: "{typography.diff-row}"
    padding: "0 6px"
---

# Design System: revu

## 1. Overview

**Creative North Star: "The Native Workshop"**

revu is a quiet, well-made desktop tool laid out on a clean bench. It looks like
something a working engineer assembled for themselves — not a piece of marketing,
not a generic Electron shell, not a SaaS dashboard. Polish lives in the small
things: a real focus ring, a 1px hairline border that knows what it's separating,
macOS vibrancy that breathes with the desktop behind it, monospace numerals in
the right places, transitions measured in tens of milliseconds.

The system rejects loud color, hero metrics, gradient accents, decorative cards,
and the entire visual vocabulary of the AWS Console. It rejects the heavy chrome
of a generic Electron app. Most of all it rejects anything that would make a
reader say *"AI wrote that."* The diff is the product; every other surface earns
its space by being out of the way when the reviewer is reading code.

Color is restrained. One cool blue accent (**Hairline Blue**) carries every
focus, every active state, every primary intent — and it appears on less than
10% of any given screen. The neutrals form a tight five-step **Cool Slate**
ladder, very slightly tinted toward the accent so the whole surface reads as
one piece. Status semantics get four named roles (ok green / warn amber / bad
red / neutral) and never bleed beyond their job.

**Key Characteristics:**

- **Hairline-first elevation.** 1px borders, not shadows, define every edge. Shadows are a Mac affordance, not a structural device.
- **Native chrome.** macOS gets translucent vibrancy and traffic-light spacing; Windows gets clean opaque panels. Same tokens, different posture.
- **Dense, monospace-forward typography.** 13px base sans for UI, ui-monospace for code and identifiers. Hierarchy through weight and uppercase labels, not big type.
- **Accent as a single voice.** One blue. Every focus ring, primary button, active row, and link uses it. Nothing else competes.
- **Theme-swap ready, dark-first.** The token set is structured so a light theme can land without rewriting components. Today it ships dark only.

## 2. Colors: The Cool Slate Palette

A tight, cool, slightly-tinted palette. Every neutral leans a few degrees toward
the accent's hue so the surface holds together as one piece rather than feeling
assembled from off-the-shelf greys. Status colors stay strictly functional.

### Primary

- **Hairline Blue** (`#5b8def`, ≈`oklch(64% 0.15 254)`): The single accent. Appears on focus rings, the primary button's fill, the active row in the file sidebar (as `accent-fade`), branch source pills, links, sort arrows in the PR table, the merge status badge, and the small "add comment" button that surfaces on diff-line hover. Nowhere else.
- **Hairline Blue Fade** (`#2a3a5e`): The accent at 20% intent. Used as the background tint for the active file-sidebar item and the active segmented-button option. This is the only place Hairline Blue spreads across a meaningful surface area; even here it's quiet.
- **Hairline Blue Focus** (`rgba(91, 141, 239, 0.34)`): The 3px focus-ring glow around any keyboard-focused control.
- **Primary Text** (`#f7faff`): Text on the primary button fill. Slightly bluer than the neutral text token to read crisply against the accent.

### Neutral (Cool Slate ladder, 4 steps)

Numbered low-to-high lightness; "lower number = darker" matches the existing variable naming.

- **Cool Slate 900** (`#0f1115`, ≈`oklch(15% 0.01 254)`): App background. The reading surface; the canvas behind everything else.
- **Cool Slate 800** (`#161a22`, ≈`oklch(20% 0.013 254)`): Surface 1. Topbar, sidebars, settings panel, table sticky header, file-section header. The chrome that frames the content.
- **Cool Slate 700** (`#1c2230`, ≈`oklch(23% 0.018 254)`): Surface 2. Inline thread cards, composer cards, segmented control track, branch pills, code blockquote background. Sits on top of Surface 1; never nests further.
- **Cool Slate 600** (`#262d3c`, ≈`oklch(28% 0.022 254)`): Hairline border. The single 1px stroke that separates every adjacent surface, panel, control, badge, and card.
- **Text Primary** (`#e6e9ef`, ≈`oklch(92% 0.008 254)`): All body text, headings, control labels.
- **Text Dim** (`#8a93a6`, ≈`oklch(62% 0.025 254)`): Section labels (uppercase), metadata, hints, dim diff gutters, secondary chrome.

### Tertiary: Status semantics (4 fixed roles)

Used for diff lines, PR badges, file change types, hint states. **Never** decorative.

- **Ok Green** (`#4ade80`, ≈`oklch(80% 0.18 145)`): Open PRs, approved status, added diff lines (as 12% tint), added file change type (`A`), success hints.
- **Warn Amber** (`#facc15`, ≈`oklch(83% 0.18 90)`): Modified file change type (`M`). Reserved for ambiguous/in-progress, not used elsewhere yet.
- **Bad Red** (`#f87171`, ≈`oklch(70% 0.17 22)`): Not-approved status, deleted diff lines (as 12% tint), deleted file change type (`D`), errors. Renamed file change type (`R`) uses the accent blue, not red.
- **Neutral Slate** (`#94a3b8`, ≈`oklch(70% 0.025 254)`): Closed PRs, unknown/no-rules approval, generic dim states.

### Named Rules

**The One Voice Rule.** Hairline Blue is the only accent. If a new screen needs
to highlight something, the answer is Hairline Blue — or a stronger weight, or
better hierarchy. Never a second accent color. Never a gradient.

**The 10% Rule.** Hairline Blue covers no more than 10% of any rendered viewport
across all its appearances combined (rings, fills, fades, links). When it starts
to creep past 10%, something is over-using attention; rework the screen, don't
desaturate the blue.

**The Hairline Rule.** Surfaces are separated by 1px borders in Cool Slate 600,
not by shadows. If a new surface needs to feel "lifted," the right answer is
almost always a different background step in the ladder plus the same 1px
hairline — not a drop shadow. Shadows on dark are noise.

**The Status-Color Lockdown.** Ok / Warn / Bad / Neutral are the only roles
those colors serve. Don't use Ok Green for "saved", don't use Bad Red for
"deleted-but-recoverable", don't introduce a fifth status color. If you need
nuance, use copy, not color.

## 3. Typography

**Body / UI Font:** System sans stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif`. The platform's own UI face on Mac (SF Pro) and Windows (Segoe UI). The font of the host OS, not a brand choice.

**Code / Mono Font:** System mono stack — `ui-monospace, 'SF Mono', Menlo, monospace`. SF Mono on Mac, Cascadia/Consolas/Menlo elsewhere. Used for all code, diff content, branch names, commit IDs, file paths in the diff header, keyboard chips, and the `summary` line in the topbar.

**Character:** The pairing is deliberately invisible. The reviewer should feel
they are looking at their *operating system's* application, not at revu's brand
typography. That's the whole point. Distinctive type would fight the Native
Workshop.

### Hierarchy

The scale is intentionally flat (1.07–1.14 ratio between steps). Hierarchy
comes from **weight, case, and color**, not from large type. A 13px UI is dense
on purpose — engineers reading dense code don't need spacious chrome.

- **Display** (600, 18px, line-height 1.25): Markdown h1 inside a PR description. The only "large" type in the app, and even here it's modest.
- **Headline** (600, 16px, line-height 1.25): Markdown h2. Bordered underline (1px Cool Slate 600) for context.
- **Title** (600, 14px, line-height 1.3): Markdown h3, comment authors, file paths in the file-section header.
- **Body** (400, 13px, line-height 1.5): All UI text. Buttons, inputs, badges, list items, comments. The default and the most-used step.
- **Label** (600, 11px, line-height 1.2, letter-spacing 0.5px, **uppercase**): Section labels (`PR meta`, `settings panel h3`, `composer head`, table headers). The strongest hierarchical signal in the app — uppercase + dim color + tight letter-spacing communicates "this is metadata, not content."
- **Code** (400, 12px, line-height 1.5): Inline code, code blocks, branch pills, commit IDs.
- **Diff row** (400, 12px, line-height **18px** fixed): The line-height is in pixels, not unitless, because diff virtualization depends on every row being exactly 18px tall to compute placeholder heights for unmounted hunks. Don't change this without re-checking `FileDiffSection`.

### Named Rules

**The Host-OS Rule.** Never ship a custom font with revu. The body and code
stacks are the host operating system's own faces. If a designer reaches for a
brand sans or a "designer monospace," reject the change.

**The Tabular-Numerals Rule.** Anywhere numbers are compared at a glance — line
numbers in the diff gutter, file change counts, PR IDs — use `font-variant-numeric: tabular-nums`. Today this is implicit in the monospace stack; if a number lives in body sans (e.g., comment counts), opt in explicitly.

**The Uppercase-Label Rule.** Any text styled as Label (11px uppercase, 0.5px letter-spacing, Text Dim) is metadata, not content. Don't write content into labels and don't style content as labels. The reviewer reads them as scaffolding.

## 4. Elevation

revu is **flat-with-hairlines on Windows** and **flat-with-hairlines-plus-vibrancy on macOS**. There is no general drop-shadow system. Depth is conveyed by:

1. The 4-step Cool Slate ladder (bg → panel → panel-2 → border).
2. 1px hairline borders in Cool Slate 600.
3. On macOS only: `backdrop-filter: blur(22-34px) saturate(1.35-1.5)` on chrome surfaces (topbar, sidebars, sticky panel headers), plus a single ambient card shadow on bordered containers.

The macOS treatment is a platform affordance, not decoration. It exists because
the host OS expects it; on Windows the same surfaces are opaque and look
correct without it.

### Shadow Vocabulary

- **Button stroke-and-bevel** (`inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 1px rgba(0,0,0,0.14)`): Persistent on every default button. A 1px highlight on the top inside edge and a 1px shadow under the bottom border. Reads as material, not as elevation. Mac amplifies the highlight to `rgba(255,255,255,0.09)`.
- **Button pressed** (`inset 0 1px 2px rgba(0,0,0,0.22), 0 1px 0 rgba(255,255,255,0.03)`): Replaces the stroke-and-bevel on `:active`. Inset shadow goes deeper; the highlight flips to the bottom. Combined with a 1px `translateY` to feel like a real press.
- **Mac vibrancy** (`backdrop-filter: blur(22-34px) saturate(1.35-1.5)`): Topbar, settings panel, filters bar, PR meta, file sidebar, file-sidebar-head, file-section-head, sticky table-header. Different blur radii per surface (file sidebar is the most translucent at 34px; the topbar is 28px; sticky bars are 22px). The browser-prefixed `-webkit-backdrop-filter` is always paired with the standard property.
- **Mac ambient card shadow** (`0 10px 28px rgba(0,0,0,0.16)`): Only on `.platform-darwin .file-section`, `.inline-composer`, `.inline-thread`, `.thread-flat`, `.reply-box`, `.composer`. A soft, diffuse drop shadow appropriate for a translucent floating card. Not used on Windows.
- **Focus ring** (`0 0 0 3px var(--focus-ring)`): A 3px Hairline Blue glow on any keyboard-focused control. This is the *only* color-based elevation; treat it as accessibility, not decoration.

### Named Rules

**The Flat-By-Default Rule.** New surfaces are flat. They get a 1px hairline,
not a shadow. The vibrancy/ambient-shadow treatments on macOS are pre-existing
agreements, not a license to add shadows elsewhere.

**The Vibrancy-Honors-System Rule.** Every backdrop-filter surface is
wrapped (in CSS, not JS) in `@supports not (backdrop-filter)` *and*
`@media (prefers-reduced-transparency: reduce)` fallbacks that swap to a solid
fill. Both are non-negotiable. If you add a new vibrancy surface, you add both
fallbacks in the same commit.

**The No-Shadow-On-Dark Rule.** Drop shadows on a dark base are noise; they
muddy the surface without adding hierarchy. The only exception is the macOS
ambient card shadow, which is part of the platform vibrancy treatment.

## 5. Components

A small canon — eight primitives plus the diff row. Anything new should be
expressible as a composition of these tokens before introducing a new component
shape.

### Buttons

- **Shape:** 7px corner (`{rounded.lg}`). 28px minimum height. Padding `5px 11px`.
- **Default:** Cool Slate 700 control fill with a 6% top-edge linear-gradient highlight, 1px Cool Slate 600 border, the stroke-and-bevel shadow vocabulary. Text in Primary Text token.
- **Hover:** Border shifts to Hairline Blue. Fill brightens to `control-hover` (`#273044`) and the top-edge highlight strengthens. Transition 150ms for background/border/shadow, 80ms for transform.
- **Active:** Fill drops to `control-active`, shadow inverts (inset 2px from top), and the button translates 1px down.
- **Focus-visible:** 3px Hairline Blue Focus ring around the border.
- **Primary:** Same shape, but fill is solid Hairline Blue with a 16% top-edge highlight, border is Hairline Blue, text is Primary Text. Stroke-and-bevel still present.
- **Disabled:** 50% opacity, `cursor: not-allowed`.

### Inputs (text / select / textarea)

- **Style:** Cool Slate 700 background at 95% opacity (`rgba(28, 34, 48, 0.95)`), 1px Cool Slate 600 border, 7px radius, padding `6px 10px`, 28px minimum height.
- **Focus:** Border shifts to Hairline Blue. No focus ring on inputs (the border shift IS the focus signal; the ring is reserved for buttons and clickable rows).
- **Mac override:** Background drops to `rgba(12, 15, 21, 0.46)` (much more translucent over vibrancy), inset 1px top shadow appears, placeholder text leans toward `rgba(194, 204, 224, 0.46)`.

### Segmented Control

- **Style:** A pill-shaped group with a Cool Slate 700 track, 1px Cool Slate 600 border, 6px radius, overflow hidden. Children are flush-stacked buttons separated by 1px Cool Slate 600 dividers.
- **Button:** Flat, no border, padding `6px 14px`, Text Dim color.
- **Active:** Hairline Blue Fade background, Text Primary color.
- **Mac override:** Adds 2px padding inside the track, 8px outer radius, removes the inter-button divider, and gives each button its own 6px radius. Active gets a white 10% overlay plus a soft inset highlight — closer to a macOS-native segmented control.

### Status Badge

- **Shape:** Pill (`{rounded.pill}` = 999px), 2px vertical / 8px horizontal padding, Label typography (11px).
- **Pattern:** Background is the status color at 12% opacity, text is the status color at 100%, border is the status color at 30–40% opacity. Same recipe for every variant — Open (Ok Green), Merged (Hairline Blue), Closed (Neutral Slate), Approved (Ok Green), Not Approved (Bad Red), No Rules / Unknown (Text Dim with default border).
- **Never decorative.** A badge means status; if the data isn't a status, don't reach for a badge.

### Change Type Chip (A / M / D / R)

- **Shape:** 16px wide single-letter mono chip, 3px radius, font-weight 600, 11px monospace, 1px vertical padding.
- **A (Added):** Ok Green at 18% bg / 100% fg.
- **M (Modified):** Warn Amber at 18% bg / 100% fg.
- **D (Deleted):** Bad Red at 18% bg / 100% fg.
- **R (Renamed):** Hairline Blue at 18% bg / 100% fg.
- **Rule:** The chip carries the letter AND the color. Don't drop the letter when the icon is "obvious"; the letter is the accessibility affordance.

### Branch Pill

- **Shape:** Cool Slate 700 background, 1px Cool Slate 600 border, 4px radius, 2px / 8px padding, code typography (11px mono).
- **Source variant:** Border shifts to Hairline Blue at 40%, text becomes Hairline Blue. Used for the source branch in PR metadata.
- **Destination variant:** Border shifts to Ok Green at 40%, text becomes Ok Green. Used for the destination branch.

### File List Item (file sidebar)

- **Shape:** Flush list item, 5px / 8px padding, 6px radius, 2px / 8px outer margin (so it floats inside the sidebar with breathing room), 1px transparent border that becomes visible on active.
- **Hover:** Background fades to Cool Slate 700.
- **Active:** Background becomes Hairline Blue Fade (`#2a3a5e`), border becomes Hairline Blue at 32%, faint inset 1px Hairline Blue glow at 10%.
- **Reviewed:** 55% opacity, file path gets a `line-through` strike in Text Dim. The reviewer can see at a glance what they've finished.
- **Truncation:** File paths use `direction: rtl` + `text-overflow: ellipsis` so the basename always remains visible when the parent path is long — engineers identify files by basename first.

### Diff Row

- **Shape:** A 4-column CSS grid — `48px gutter-old | 48px gutter-new | 18px mark | 1fr content`. Row height is fixed at 18px line-height. Padding is 0 6px on every cell.
- **Default:** Gutters in Cool Slate 800 with Text Dim numbering, mono-text content in Text Primary.
- **Added:** Content cell tinted Ok Green at 12%, gutter cell tinted Ok Green at 8%, content text shifted to a brighter green-tinted neutral (`#b9f0c8`).
- **Deleted:** Content cell tinted Bad Red at 12%, gutter cell tinted Bad Red at 8%, content text shifted to a brighter red-tinted neutral (`#fbc4c4`).
- **Hover affordance:** On hover, an 18px circular Hairline Blue "+" button appears on the right edge of the new-side gutter. This is the only persistent decorative element inside the diff body.
- **Threads / composers:** Render as full-width block rows inside the same diff column, separated from the diff above and below by a 1px Cool Slate 600 dashed border (not solid — the dash signals "this row is not code").

### Signature: File Section card

The bordered file container in the continuous diff is revu's signature component
because it carries a non-obvious performance commitment.

- **Shape:** 1px Cool Slate 600 border, 8px radius, 12px outer margin, sticky 8px / 12px Cool Slate 800 header with the file path and a collapse button.
- **Virtualization contract:** Each `.file-section` declares `content-visibility: auto` and `contain-intrinsic-size: auto 600px` so the browser elides layout and paint for off-screen sections. This is the load-bearing reason scrolling stays smooth on 50k-line diffs. **Do not** add transforms, opacity transitions, or any property that would force a layout/paint on the file section — the whole point is that the browser is allowed to skip it.
- **Reviewed state:** The section fades to 70% opacity. Same affordance as the file list item — visible progress.

### Named Rules

**The Hairline-Border Rule.** Every visible boundary in revu is a 1px Cool Slate 600 border. Not 2px, not 3px, not a side-stripe (`border-left: 4px solid …`), not a gradient. If you want a stronger separation, change the surface tone, don't thicken the border.

**The No-Card-Nesting Rule.** Cards (`.file-section`, `.inline-thread`, `.composer`) live directly on the page background. They never contain another card. If you find yourself wrapping a card in a card, the inner thing isn't a card — it's a section of the outer card and should be styled with hairline dividers, not a second border.

**The 28px-Control Rule.** Every interactive control — button, input, select, segmented option — has a minimum height of 28px. This is the keyboard-target floor and the visual rhythm. New controls match this height, even when they look like they could be smaller.

## 6. Do's and Don'ts

### Do:

- **Do** use a single 1px Cool Slate 600 (`#262d3c`) border for every surface boundary. Two layouts that look "different" usually want different *background steps* in the Cool Slate ladder, not different borders.
- **Do** keep Hairline Blue (`#5b8def`) on ≤10% of any screen, combined across rings/fills/links/active states. Restraint IS the brand.
- **Do** put `prefers-reduced-transparency` fallbacks on every new `backdrop-filter` surface in the same commit. The pattern lives at the bottom of `index.css`; copy it.
- **Do** add a `prefers-reduced-motion` block as new transitions are introduced — PRODUCT.md commits to honoring it. Today `index.css` only handles `prefers-reduced-transparency`. Close the gap as motion is added.
- **Do** route every new color through one of the existing tokens. If a new color is needed, raise it as a token-set change, not a one-off hex in a component.
- **Do** assume the reviewer is an engineer. Terse labels, monospace where it matters, no tooltips explaining git or PRs.
- **Do** use the Label step (11px uppercase, 0.5px letter-spacing, Text Dim) for metadata. The uppercase IS the hierarchy.
- **Do** keep diff row heights at exactly 18px. The continuous-diff virtualization in `FileDiffSection` computes placeholder heights from this constant.
- **Do** structure new tokens so a light theme can drop in alongside the dark set without rewriting components. PRODUCT.md commits to shipping a real light theme; design for theme-swap from day one.

### Don't:

- **Don't** ship anything that looks like the **AWS Console**. Orange accents, dense form layouts, generic enterprise chrome — none of it. We're the antidote.
- **Don't** ship anything that looks like a **generic Slack-shaped Electron app**. Heavy custom title bars, non-native scrollbars, oversized avatars, emoji garnish, mismatched window controls. The fact that we're in Electron should be invisible.
- **Don't** introduce **SaaS dashboard clichés**: big hero metric tiles, gradient accents, decorative card grids, hero-illustrated empty states, AI-generated icon sets, a cheerful welcome screen. revu has no marketing surface — don't smuggle one in.
- **Don't** ship **AI-coded slop**: glassmorphism for its own sake, gradient text (`background-clip: text`), side-stripe borders (`border-left: 4px solid ...`), identical card grids with icon + heading + text repeated, emoji in section headings, or copy that restates the heading. PRODUCT.md calls these out by name; carry the line.
- **Don't** introduce a second accent color. The One Voice Rule is the whole point.
- **Don't** add drop shadows on dark surfaces. The macOS vibrancy + ambient card shadow is the only exception, and it's a platform affordance, not a general license.
- **Don't** nest cards. If you reach for a second border inside a `.file-section` or a `.composer`, restructure with hairline dividers and tonal layering instead.
- **Don't** rely on color alone for status. Every status surface (badges, change-type chips, diff rows) carries both a label/letter AND a color. Keep this discipline as new states are added.
- **Don't** ship a custom font. The body and code stacks are the host operating system's own faces; that's the Native Workshop.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent. Side-stripe borders are the universal slop tell.
- **Don't** use em dashes in UI copy or commit messages. PRODUCT.md commits to terse, native copy; ASCII punctuation only.
- **Don't** animate CSS layout properties (`width`, `height`, `margin`, `padding`). If something needs to move, animate `transform` and `opacity`.
- **Don't** let the diff body decorate itself. Inside `.continuous-diff`, only the Hairline Blue hover "+" button is a permitted persistent affordance. Anything else competes with the code.
