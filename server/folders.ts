import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fullPath, isDirectory, samePath } from './projects.ts';

export interface Suggestion {
  name: string;
  path: string;
  lastUsed: number;
}

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
const HEAD_BYTES = 256 * 1024;

/**
 * Folders Claude Code has been used in. Directory names under ~/.claude/projects
 * are lossy encodings of the path, so the real cwd is read from the transcripts.
 */
export function claudeProjectSuggestions(): Suggestion[] {
  let dirs: string[];
  try {
    dirs = readdirSync(CLAUDE_PROJECTS);
  } catch {
    return [];
  }

  const found: Suggestion[] = [];
  for (const dir of dirs) {
    const full = join(CLAUDE_PROJECTS, dir);
    const transcripts = safeList(full)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ file: join(full, f), mtime: safeMtime(join(full, f)) }))
      .sort((a, b) => b.mtime - a.mtime);

    const fromTranscript = transcripts
      .slice(0, 3)
      .map((t) => ({ cwd: readCwd(t.file), mtime: t.mtime }))
      .find((t) => t.cwd && isDirectory(t.cwd));
    // Some folders only hold memory files; fall back to decoding the folder name.
    const cwd = fromTranscript?.cwd ?? decodeProjectDir(dir);
    if (!cwd) continue;
    const lastUsed = fromTranscript?.mtime ?? safeMtime(full);

    const existing = found.find((s) => samePath(s.path, cwd));
    if (existing) existing.lastUsed = Math.max(existing.lastUsed, lastUsed);
    else found.push({ name: basename(cwd), path: fullPath(cwd), lastUsed });
  }
  return found.sort((a, b) => b.lastUsed - a.lastUsed);
}

/**
 * `C--Users-me-my-app` -> `C:\Users\me\my-app`. Every separator became `-`, so
 * try both readings of each dash and keep the one that exists on disk.
 */
function decodeProjectDir(dir: string): string | null {
  const drive = dir.match(/^([a-zA-Z])--(.+)$/);
  const root = drive ? `${drive[1].toUpperCase()}:\\` : '/';
  const parts = (drive ? drive[2] : dir.replace(/^-/, '')).split('-');

  const walk = (base: string, i: number): string | null => {
    if (i === parts.length) return base;
    let segment = '';
    for (let j = i; j < parts.length; j++) {
      segment = segment ? `${segment}-${parts[j]}` : parts[j];
      const candidate = join(base, segment);
      if (isDirectory(candidate)) {
        const result = walk(candidate, j + 1);
        if (result) return result;
      }
    }
    return null;
  };
  return walk(root, 0);
}

function readCwd(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const read = readSync(fd, buf, 0, HEAD_BYTES, 0);
    const match = buf.toString('utf8', 0, read).match(/"cwd":("(?:[^"\\]|\\.)*")/);
    return match ? JSON.parse(match[1]) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export interface FolderListing {
  path: string | null;
  parent: string | null;
  dirs: { name: string; path: string }[];
}

/** One level of the file system. A null path lists the drives (Windows) or `/`. */
export function listFolder(path: string | null): FolderListing {
  if (!path) {
    if (process.platform !== 'win32') return listFolder('/');
    const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'
      .split('')
      .map((l) => `${l}:\\`)
      .filter(isDirectory);
    return { path: null, parent: null, dirs: drives.map((d) => ({ name: d, path: d })) };
  }

  const full = fullPath(path);
  if (!isDirectory(full)) throw new Error('Folder not found');
  const parentPath = dirname(full);
  const atRoot = parentPath === full;
  const dirs = safeEntries(full)
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$'))
    .map((e) => ({ name: e.name, path: join(full, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return { path: full, parent: atRoot ? (process.platform === 'win32' ? null : full) : parentPath, dirs };
}

export function homeFolder(): string {
  return homedir();
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
