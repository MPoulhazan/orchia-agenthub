import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionRecord } from './session.ts';

const SAVE_DELAY = 300;

/** Sessions are written to disk on every change, so a crash or a closed terminal loses nothing. */
export class SessionStore {
  private readonly file: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => SessionRecord[]) | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'sessions.json');
  }

  load(): SessionRecord[] {
    if (!existsSync(this.file)) return [];
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch (err) {
      console.error(`Could not read ${this.file}:`, err);
      return [];
    }
  }

  /** Debounced: bursts of hook events end up as one write. */
  save(records: () => SessionRecord[]) {
    this.pending = records;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sessions: this.pending() }, null, 2));
    renameSync(tmp, this.file);
    this.pending = null;
  }
}

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');

/** Claude Code only writes a transcript once the conversation has a message. */
export function hasTranscript(claudeSessionId: string): boolean {
  try {
    return readdirSync(CLAUDE_PROJECTS).some((dir) => existsSync(join(CLAUDE_PROJECTS, dir, `${claudeSessionId}.jsonl`)));
  } catch {
    return false;
  }
}
