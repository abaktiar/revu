import { app, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ChecklistItem,
  ChecklistTemplate,
  ChecklistTemplateFile,
} from '@shared/types';

// Per-repo PR-approval checklist templates. A single JSON file keyed by
// repository name, loaded once into memory — same shape as branchPrefs.ts /
// reviewed.ts. Local to the machine; the export/import pair is how a team
// shares one (architecture rule #3 keeps dialog + fs in the main process).
const FILE_NAME = 'checklist-templates.json';

type Persisted = Record<string, ChecklistTemplate>;

let cache: Persisted | null = null;

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

async function readAll(): Promise<Persisted> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw) as Persisted;
    cache = parsed && typeof parsed === 'object' ? parsed : {};
    return cache;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      cache = {};
      return cache;
    }
    throw err;
  }
}

async function writeAll(next: Persisted): Promise<void> {
  cache = next;
  await fs.writeFile(filePath(), JSON.stringify(next, null, 2), 'utf8');
}

function emptyTemplate(repositoryName: string): ChecklistTemplate {
  return { repositoryName, items: [] };
}

// Normalize arbitrary item input (from the renderer or an import file) into
// clean ChecklistItems: trimmed non-empty text, fresh ids, boolean required.
function sanitizeItems(
  items: Array<{ id?: string; text?: unknown; required?: unknown }>,
): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const it of items) {
    const text = typeof it.text === 'string' ? it.text.trim() : '';
    if (!text) continue;
    out.push({
      id: typeof it.id === 'string' && it.id ? it.id : randomUUID(),
      text,
      required: it.required === true,
    });
  }
  return out;
}

export async function getChecklistTemplate(
  repositoryName: string,
): Promise<ChecklistTemplate> {
  const all = await readAll();
  return all[repositoryName] ?? emptyTemplate(repositoryName);
}

export async function setChecklistTemplate(
  repositoryName: string,
  items: ChecklistItem[],
): Promise<ChecklistTemplate> {
  const all = await readAll();
  const next: ChecklistTemplate = {
    repositoryName,
    items: sanitizeItems(items),
    updatedAt: new Date().toISOString(),
  };
  all[repositoryName] = next;
  await writeAll(all);
  return next;
}

// Validate + parse an import file into clean items. Throws a friendly error on
// a malformed file so the renderer can surface it.
function parseTemplateFile(raw: string): ChecklistItem[] {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const file = doc as Partial<ChecklistTemplateFile>;
  if (!file || file.revuChecklistTemplate !== 1 || !Array.isArray(file.items)) {
    throw new Error(
      'That file is not a revu checklist template (missing "revuChecklistTemplate": 1).',
    );
  }
  const items = sanitizeItems(file.items);
  if (items.length === 0) {
    throw new Error('That checklist template has no items.');
  }
  return items;
}

// Open a save dialog and write the repo's template as a shareable JSON file.
// Returns false if the user cancelled.
export async function exportChecklistTemplate(
  repositoryName: string,
): Promise<boolean> {
  const tpl = await getChecklistTemplate(repositoryName);
  const file: ChecklistTemplateFile = {
    revuChecklistTemplate: 1,
    repositoryName,
    exportedAt: new Date().toISOString(),
    items: tpl.items.map((i) => ({ text: i.text, required: i.required })),
  };
  const win = BrowserWindow.getFocusedWindow() ?? undefined;
  const safeRepo = repositoryName.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const result = await dialog.showSaveDialog(win as BrowserWindow, {
    title: 'Export approval checklist',
    defaultPath: `${safeRepo || 'repo'}-checklist.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, JSON.stringify(file, null, 2), 'utf8');
  return true;
}

// Open a file dialog, validate the selected template, and replace the repo's
// items with it. Returns null if the user cancelled; throws on a bad file.
export async function importChecklistTemplate(
  repositoryName: string,
): Promise<ChecklistTemplate | null> {
  const win = BrowserWindow.getFocusedWindow() ?? undefined;
  const result = await dialog.showOpenDialog(win as BrowserWindow, {
    title: 'Import approval checklist',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const raw = await fs.readFile(result.filePaths[0]!, 'utf8');
  const items = parseTemplateFile(raw);
  return setChecklistTemplate(repositoryName, items);
}
