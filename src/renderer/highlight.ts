// Single hljs instance with the common-language bundle (~36 languages including
// ts/tsx/js/jsx, python, go, rust, java, c/cpp, c#, ruby, php, kotlin, swift,
// shell, sql, yaml, json, html, css, markdown, dockerfile, ...).
import hljs from 'highlight.js/lib/common';

// Extra grammars not in the "common" bundle but useful for code review.
import yaml from 'highlight.js/lib/languages/yaml';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import scss from 'highlight.js/lib/languages/scss';

if (!hljs.getLanguage('yaml')) hljs.registerLanguage('yaml', yaml);
if (!hljs.getLanguage('dockerfile')) {
  hljs.registerLanguage('dockerfile', dockerfile);
}
if (!hljs.getLanguage('scss')) hljs.registerLanguage('scss', scss);

// File-extension → hljs language id. We deliberately omit anything we don't
// have a grammar for so callers fall back to plain text instead of asking
// hljs to guess (auto-detect is slower and noisy for short snippets).
const BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  cs: 'csharp',
  php: 'php',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cxx: 'cpp',
  hxx: 'cpp',
  m: 'objectivec',
  mm: 'objectivec',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  svg: 'xml',
  html: 'xml',
  htm: 'xml',
  vue: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  mdx: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  sql: 'sql',
  dockerfile: 'dockerfile',
};

const BY_BASENAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  rakefile: 'ruby',
  gemfile: 'ruby',
};

export function languageForPath(path: string): string | null {
  const lower = path.toLowerCase();
  const slash = lower.lastIndexOf('/');
  const base = slash >= 0 ? lower.slice(slash + 1) : lower;
  if (BY_BASENAME[base]) return BY_BASENAME[base]!;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = base.slice(dot + 1);
  return BY_EXT[ext] ?? null;
}

export function highlightLine(content: string, language: string | null): string {
  if (!language || !hljs.getLanguage(language)) return escapeHtml(content);
  try {
    return hljs.highlight(content, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(content);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
