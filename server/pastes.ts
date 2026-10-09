import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './projects.ts';

/**
 * Images pasted or dropped on a terminal. Claude Code can't read the browser's
 * clipboard, so each image is saved here and its path typed into the prompt,
 * where Claude Code attaches it as [Image #n].
 *
 * Claude Code copies the image into its transcript when attaching it, so the
 * files are only needed briefly: they go after a week, oldest first beyond 200 MB.
 */

export const PASTE_DIR = join(CONFIG_DIR, 'pastes');
export const MAX_PASTE_BYTES = 20 * 1024 * 1024;

const KEEP_MS = 7 * 24 * 3600_000;
const KEEP_BYTES = 200 * 1024 * 1024;
const CLEAN_EVERY_MS = 3600_000;

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function isPasteType(type: string): boolean {
  return type in EXT;
}

/** Saves the image and returns its absolute path. */
export function savePaste(data: Buffer, type: string): string {
  mkdirSync(PASTE_DIR, { recursive: true });
  // Sortable by time, unique within the same second.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const file = join(PASTE_DIR, `${stamp}-${randomBytes(3).toString('hex')}.${EXT[type]}`);
  writeFileSync(file, data);
  cleanPastes();
  return file;
}

/** Deletes pastes older than a week, then the oldest ones until the folder fits in 200 MB. */
export function cleanPastes(now = Date.now()) {
  let files: { path: string; mtime: number; size: number }[];
  try {
    files = readdirSync(PASTE_DIR).flatMap((name) => {
      const path = join(PASTE_DIR, name);
      const st = statSync(path);
      return st.isFile() ? [{ path, mtime: st.mtimeMs, size: st.size }] : [];
    });
  } catch {
    return; // No folder yet.
  }
  files.sort((a, b) => b.mtime - a.mtime);
  let total = 0;
  for (const f of files) {
    total += f.size;
    if (now - f.mtime <= KEEP_MS && total <= KEEP_BYTES) continue;
    try {
      rmSync(f.path);
    } catch {
      // In use or already gone: next round.
    }
  }
}

export function startPasteCleanup() {
  cleanPastes();
  setInterval(cleanPastes, CLEAN_EVERY_MS).unref();
}
