import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * What the inspector shows about a session: live numbers from Claude Code's
 * status line, the plan it keeps with its task tools, and the git state of
 * the folder it works in.
 */

export interface Usage {
  costUsd: number | null;
  /** Tokens in the context window after the last reply, and the window size. */
  contextUsed: number | null;
  contextSize: number | null;
  /** Time spent waiting for the model. */
  apiMs: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
}

export type PlanStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanItem {
  id: string;
  text: string;
  status: PlanStatus;
}

// ---- Status line ---------------------------------------------------------------

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Reads the fields we use from the JSON Claude Code gives its status line command. */
export function usageFromStatusLine(payload: any): Usage {
  const cw = payload?.context_window ?? {};
  const current = cw.current_usage;
  // The same input-only sum Claude Code uses for used_percentage.
  const contextUsed = current
    ? (num(current.input_tokens) ?? 0) + (num(current.cache_creation_input_tokens) ?? 0) + (num(current.cache_read_input_tokens) ?? 0)
    : null;
  return {
    costUsd: num(payload?.cost?.total_cost_usd),
    contextUsed,
    contextSize: num(cw.context_window_size),
    apiMs: num(payload?.cost?.total_api_duration_ms),
    linesAdded: num(payload?.cost?.total_lines_added),
    linesRemoved: num(payload?.cost?.total_lines_removed),
  };
}

/** One plan usage window: how much is used, and when it starts over (ms since epoch). */
export interface LimitWindow {
  usedPct: number;
  resetsAt: number | null;
}

/** The subscription's 5-hour and weekly limits. They belong to the account, not to a session. */
export interface RateLimits {
  fiveHour: LimitWindow | null;
  sevenDay: LimitWindow | null;
}

function limitWindow(raw: any): LimitWindow | null {
  const usedPct = num(raw?.used_percentage);
  if (usedPct === null) return null;
  const at = raw.resets_at;
  // Seconds since epoch; tolerate an ISO date too.
  const resetsAt = typeof at === 'number' ? at * 1000 : typeof at === 'string' ? Date.parse(at) || null : null;
  // Whole percents, like Claude Code shows them; also keeps refreshes from rebroadcasting noise.
  return { usedPct: Math.floor(usedPct), resetsAt };
}

/** Only Pro and Max plans get these, and only after the session's first reply; null otherwise. */
export function limitsFromStatusLine(payload: any): RateLimits | null {
  const fiveHour = limitWindow(payload?.rate_limits?.five_hour);
  const sevenDay = limitWindow(payload?.rate_limits?.seven_day);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

function readStatusLine(file: string): string | null {
  try {
    const statusLine = JSON.parse(readFileSync(file, 'utf8'))?.statusLine;
    return statusLine?.type === 'command' && typeof statusLine.command === 'string' ? statusLine.command : null;
  } catch {
    return null;
  }
}

/**
 * The status line the user configured for this folder. Ours replaces it (the
 * `--settings` layer wins), so the relay runs it afterwards.
 */
export function userStatusLine(cwd: string): string | null {
  const files = [
    join(cwd, '.claude', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const command = readStatusLine(file);
    if (command) return command;
  }
  return null;
}

// ---- Plan -------------------------------------------------------------------------

const STATUSES = new Set<PlanStatus>(['pending', 'in_progress', 'completed']);
const planStatus = (value: unknown): PlanStatus | null => (STATUSES.has(value as PlanStatus) ? (value as PlanStatus) : null);

/**
 * Follows the plan through PostToolUse hooks. Claude Code keeps it with
 * TaskCreate / TaskUpdate, or with TodoWrite when tasks are turned off.
 * Returns the new plan, or null when the hook does not touch it.
 */
export function nextPlan(plan: PlanItem[], payload: any): PlanItem[] | null {
  if (payload?.hook_event_name !== 'PostToolUse') return null;
  const input = payload.tool_input ?? {};
  const response = payload.tool_response ?? {};

  switch (payload.tool_name) {
    case 'TodoWrite': {
      if (!Array.isArray(input.todos)) return null;
      return input.todos.map((todo: any, i: number) => ({
        id: String(i + 1),
        text: String(todo?.content ?? ''),
        status: planStatus(todo?.status) ?? 'pending',
      }));
    }
    case 'TaskCreate': {
      if (typeof input.subject !== 'string') return null;
      const id = response?.task?.id ?? response?.id ?? response?.taskId;
      return [...plan, { id: id != null ? String(id) : String(plan.length + 1), text: input.subject, status: 'pending' }];
    }
    case 'TaskUpdate': {
      const id = String(input.taskId ?? '');
      if (!plan.some((item) => item.id === id)) return null;
      if (input.status === 'deleted') return plan.filter((item) => item.id !== id);
      return plan.map((item) =>
        item.id === id
          ? { ...item, text: typeof input.subject === 'string' ? input.subject : item.text, status: planStatus(input.status) ?? item.status }
          : item,
      );
    }
    default:
      return null;
  }
}

// ---- Git ----------------------------------------------------------------------------

export interface ChangedFile {
  path: string;
  /** null for binary files and for new files, which git diff does not count. */
  added: number | null;
  removed: number | null;
  isNew: boolean;
}

export interface GitSummary {
  branch: string | null;
  /** Commits not pushed / not pulled, when the branch tracks a remote one. */
  ahead: number | null;
  behind: number | null;
  files: ChangedFile[];
  /** Totals over every changed file, even past the listed ones. */
  fileCount: number;
  added: number;
  removed: number;
}

const MAX_FILES = 40;
const GIT_TIMEOUT = 5000;
const CACHE_MS = 1500;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

async function readGit(cwd: string): Promise<GitSummary | null> {
  let status: string;
  try {
    status = await git(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  } catch {
    return null; // not a repository, or git is missing
  }

  let branch: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  const untracked: string[] = [];
  const records = status.split('\0');
  for (let i = 0; i < records.length; i++) {
    const line = records[i];
    if (line.startsWith('# branch.head ')) {
      const head = line.slice(14);
      branch = head === '(detached)' ? null : head;
    } else if (line.startsWith('# branch.ab ')) {
      const [a, b] = line.slice(12).split(' ');
      ahead = Math.abs(Number(a));
      behind = Math.abs(Number(b));
    } else if (line.startsWith('? ')) {
      untracked.push(line.slice(2));
    } else if (line.startsWith('2 ')) {
      i++; // renames carry the original path as an extra record
    }
  }

  // Tracked changes, staged or not, against the last commit. A repository
  // without commits has no HEAD; its files all show up as untracked anyway.
  let numstat = '';
  try {
    numstat = await git(cwd, ['diff', 'HEAD', '--numstat', '--no-renames', '-z']);
  } catch {}

  const files: ChangedFile[] = [];
  for (const line of numstat.split('\0')) {
    const [a, r, ...path] = line.split('\t');
    if (!path.length) continue;
    files.push({ path: path.join('\t'), added: a === '-' ? null : Number(a), removed: r === '-' ? null : Number(r), isNew: false });
  }
  for (const path of untracked) files.push({ path, added: null, removed: null, isNew: true });

  return {
    branch,
    ahead,
    behind,
    files: files.slice(0, MAX_FILES),
    fileCount: files.length,
    added: files.reduce((sum, f) => sum + (f.added ?? 0), 0),
    removed: files.reduce((sum, f) => sum + (f.removed ?? 0), 0),
  };
}

// Several sessions often share a folder, and the inspector polls.
const gitCache = new Map<string, { at: number; value: Promise<GitSummary | null> }>();

export function gitSummary(cwd: string): Promise<GitSummary | null> {
  const hit = gitCache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = readGit(cwd);
  gitCache.set(cwd, { at: Date.now(), value });
  return value;
}
