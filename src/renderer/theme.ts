// Theme manager. Owns three pieces of state:
//   1. The user's preference ('light' | 'dark' | 'system'), driven by Settings.
//   2. The OS theme, watched via matchMedia('(prefers-color-scheme: dark)').
//   3. The *resolved* theme ('light' | 'dark'), which the rest of the app cares
//      about. Resolved = preference, or the OS theme when preference is 'system'.
//
// When the resolved theme changes we (a) toggle data-theme on <html> so the
// CSS variable blocks in index.css switch, and (b) swap the highlight.js
// stylesheet so syntax-highlighted diff content matches the surrounding palette.
//
// Vite's ?url suffix gives us the resolved asset URL without inlining the CSS;
// we inject one <link rel="stylesheet"> and rewrite its href when the theme flips.

import { useEffect, useState } from 'react';
import hljsDarkUrl from 'highlight.js/styles/github-dark.css?url';
import hljsLightUrl from 'highlight.js/styles/github.css?url';
import type { ThemePreference } from '@shared/types';

export type ResolvedTheme = 'light' | 'dark';

const HLJS_LINK_ID = 'hljs-theme';

// `systemMedia` must be declared before `resolved`, since computeResolved()
// reads it and runs as part of the resolved initializer below.
const systemMedia = window.matchMedia('(prefers-color-scheme: dark)');

function computeResolved(pref: ThemePreference): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemMedia.matches ? 'dark' : 'light';
}

let preference: ThemePreference = 'system';
let resolved: ResolvedTheme = computeResolved(preference);
const listeners = new Set<(t: ResolvedTheme) => void>();

function ensureHljsLink(): HTMLLinkElement {
  const existing = document.getElementById(HLJS_LINK_ID);
  if (existing && existing instanceof HTMLLinkElement) return existing;
  const link = document.createElement('link');
  link.id = HLJS_LINK_ID;
  link.rel = 'stylesheet';
  document.head.appendChild(link);
  return link;
}

function apply(next: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', next);
  const link = ensureHljsLink();
  const wantedHref = next === 'dark' ? hljsDarkUrl : hljsLightUrl;
  if (link.href !== new URL(wantedHref, document.baseURI).href) {
    link.href = wantedHref;
  }
}

function recompute(): void {
  const next = computeResolved(preference);
  if (next === resolved) return;
  resolved = next;
  apply(next);
  for (const l of listeners) l(next);
}

// Listen to system theme changes. Only effective when preference is 'system',
// but it's harmless to keep the listener wired all the time — recompute is a
// no-op when the resolved theme doesn't actually change.
systemMedia.addEventListener('change', recompute);

// Apply the initial theme before React mounts so the first paint already
// matches. main.tsx calls initTheme() right after this module loads.
export function initTheme(): void {
  apply(resolved);
}

export function setThemePreference(next: ThemePreference): void {
  if (preference === next) return;
  preference = next;
  recompute();
}

export function getResolvedTheme(): ResolvedTheme {
  return resolved;
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function subscribeTheme(fn: (t: ResolvedTheme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// React hook — components that need to re-render on theme flips (Monaco's
// DiffViewer is the main case) use this.
export function useResolvedTheme(): ResolvedTheme {
  const [t, setT] = useState<ResolvedTheme>(resolved);
  useEffect(() => subscribeTheme(setT), []);
  return t;
}

