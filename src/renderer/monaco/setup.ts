// Wire Monaco's web-worker loader. Must be imported before any Monaco use.
// Vite's ?worker suffix produces a Worker constructor we can hand to
// MonacoEnvironment — no CDN, works under Electron's CSP.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import * as monaco from 'monaco-editor';

// Read-only diff viewer doesn't need language services (ts, json, css, html
// workers) — basic syntax highlighting works with the editor worker alone.
self.MonacoEnvironment = {
  getWorker(): Worker {
    return new EditorWorker();
  },
};

export { monaco };
