import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CommentDraft, RelativeFileVersion } from '@shared/types';

const FILE_NAME = 'drafts.json';

let cache: CommentDraft[] | null = null;

function draftsPath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

async function readAll(): Promise<CommentDraft[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(draftsPath(), 'utf8');
    const parsed = JSON.parse(raw) as CommentDraft[];
    cache = Array.isArray(parsed) ? parsed : [];
    return cache;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      cache = [];
      return cache;
    }
    throw err;
  }
}

async function writeAll(next: CommentDraft[]): Promise<void> {
  cache = next;
  await fs.writeFile(draftsPath(), JSON.stringify(next, null, 2), 'utf8');
}

export async function listDrafts(
  pullRequestId: string,
): Promise<CommentDraft[]> {
  const all = await readAll();
  return all.filter((d) => d.pullRequestId === pullRequestId);
}

export async function saveDraft(input: {
  id?: string;
  pullRequestId: string;
  repositoryName: string;
  filePath: string;
  filePosition: number;
  relativeFileVersion: RelativeFileVersion;
  content: string;
  inReplyTo?: string;
}): Promise<CommentDraft> {
  const all = await readAll();
  const id = input.id ?? randomUUID();
  const existingIdx = all.findIndex((d) => d.id === id);
  const draft: CommentDraft = {
    id,
    pullRequestId: input.pullRequestId,
    repositoryName: input.repositoryName,
    filePath: input.filePath,
    filePosition: input.filePosition,
    relativeFileVersion: input.relativeFileVersion,
    content: input.content,
    inReplyTo: input.inReplyTo,
    createdAt: existingIdx >= 0 ? (all[existingIdx]?.createdAt ?? nowIso()) : nowIso(),
  };
  if (existingIdx >= 0) all[existingIdx] = draft;
  else all.push(draft);
  await writeAll(all);
  return draft;
}

export async function deleteDraft(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((d) => d.id !== id));
}

function nowIso(): string {
  return new Date().toISOString();
}
