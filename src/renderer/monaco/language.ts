const BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'csharp',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'plaintext',
  ini: 'ini',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  rb: 'ruby',
  php: 'php',
  kt: 'kotlin',
  swift: 'swift',
  vue: 'html',
  dockerfile: 'dockerfile',
};

const BY_BASENAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
  '.gitignore': 'plaintext',
};

export function languageFor(path: string): string {
  const lower = path.toLowerCase();
  const slash = lower.lastIndexOf('/');
  const base = slash >= 0 ? lower.slice(slash + 1) : lower;
  if (BY_BASENAME[base]) return BY_BASENAME[base]!;
  const dot = base.lastIndexOf('.');
  if (dot >= 0) {
    const ext = base.slice(dot + 1);
    if (BY_EXT[ext]) return BY_EXT[ext]!;
  }
  return 'plaintext';
}
