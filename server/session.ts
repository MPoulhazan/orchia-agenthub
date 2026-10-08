import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IPty } from '@lydell/node-pty';
import type { Activity, ActivityUpdate } from './hooks.ts';

// These packages ship CommonJS entry points; load them through require.
const require = createRequire(import.meta.url);
const pty: typeof import('@lydell/node-pty') = require('@lydell/node-pty');
const { Terminal: HeadlessTerminal } = require('@xterm/headless') as typeof import('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize');

const SCROLLBACK = 5000;

export type SessionStatus = 'running' | 'exited';

export interface SessionInfo {
  id: string;
  projectId: string;
  name: string;
  cwd: string;
  status: SessionStatus;
  exitCode: number | null;
  createdAt: number;
  activity: Activity;
  detail: string | null;
  /** Claude finished or asked for something since the user last looked at it. */
  unseen: boolean;
}

/**
 * One claude process in a PTY. The PTY output is mirrored into a headless
 * terminal so a client connecting later (page reload, switching sessions)
 * receives the current screen instead of a raw replay of the byte stream.
 *
 * Events: 'data' (output chunk), 'reset' (process restarted), 'change' (info changed).
 */
export class Session extends EventEmitter {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  status: SessionStatus = 'running';
  exitCode: number | null = null;
  activity: Activity = 'starting';
  detail: string | null = null;
  unseen = false;
  /** Shared with the hooks so only this session's claude can report its activity. */
  readonly token = randomBytes(24).toString('hex');

  private proc!: IPty;
  private mirror!: InstanceType<typeof HeadlessTerminal>;
  private serializer!: InstanceType<typeof SerializeAddon>;

  constructor(
    readonly projectId: string,
    readonly cwd: string,
    public name: string,
    private readonly hookSettings: string | null,
    private cols = 120,
    private rows = 32,
  ) {
    super();
    this.start();
  }

  private start() {
    this.mirror = new HeadlessTerminal({ cols: this.cols, rows: this.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.mirror.loadAddon(this.serializer);
    this.status = 'running';
    this.exitCode = null;
    this.activity = 'starting';
    this.detail = null;
    this.unseen = false;

    const [file, args] = claudeCommand(this.hookSettings);
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: {
        ...cleanEnv(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        AGENTHUB_SESSION_ID: this.id,
        AGENTHUB_TOKEN: this.token,
      },
    });
    this.proc = proc;
    const mirror = this.mirror;

    // Emit only once the mirror has parsed the chunk, so a snapshot taken at any
    // moment followed by the live stream never drops or duplicates output.
    proc.onData((data) => {
      if (this.proc !== proc) return;
      mirror.write(data, () => this.emit('data', data));
    });
    proc.onExit(({ exitCode }) => {
      if (this.proc !== proc) return; // a restart already replaced this process
      this.status = 'exited';
      this.exitCode = exitCode;
      // Queue behind pending output so clients see the last lines before the change.
      mirror.write('', () => this.emit('change'));
    });
  }

  restart() {
    const old = this.proc;
    this.mirror.dispose();
    this.start();
    if (old) old.kill();
    this.emit('reset');
    this.emit('change');
  }

  applyActivity({ activity, detail }: ActivityUpdate) {
    if (this.status !== 'running') return;
    // One question fires several hooks; keep the first, most specific reason.
    if (activity === 'waiting' && this.activity === 'waiting') return;
    const changed = activity !== this.activity || (detail ?? null) !== this.detail;
    this.activity = activity;
    this.detail = detail ?? null;
    // Finishing a turn or blocking on the user is worth a look; working is not.
    if (activity === 'waiting' || activity === 'idle') this.unseen = this.unseen || changed;
    if (changed) this.emit('change');
  }

  markSeen() {
    if (!this.unseen) return;
    this.unseen = false;
    this.emit('change');
  }

  rename(name: string) {
    this.name = name;
    this.emit('change');
  }

  write(data: string) {
    if (this.status !== 'running') return;
    this.proc.write(data);
    // Answering a prompt in the terminal unblocks Claude before any hook says so.
    if (this.activity === 'waiting' && data.includes('\r')) this.applyActivity({ activity: 'working' });
    // Esc / Ctrl+C interrupt a turn, and Claude Code fires no Stop hook in that case.
    if (this.activity === 'working' && (data === '\x1b' || data === '\x03')) {
      this.activity = 'idle';
      this.detail = null;
      this.emit('change');
    }
  }

  resize(cols: number, rows: number) {
    if (this.status !== 'running') return;
    if (cols < 2 || rows < 2 || (cols === this.cols && rows === this.rows)) return;
    this.cols = cols;
    this.rows = rows;
    this.proc.resize(cols, rows);
    this.mirror.resize(cols, rows);
  }

  /** Current screen + scrollback as an escape sequence string. */
  snapshot(): string {
    return this.serializer.serialize({ scrollback: SCROLLBACK });
  }

  dispose() {
    if (this.status === 'running') this.proc.kill();
    this.mirror.dispose();
    this.removeAllListeners();
  }

  info(): SessionInfo {
    return {
      id: this.id,
      projectId: this.projectId,
      name: this.name,
      cwd: this.cwd,
      status: this.status,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      activity: this.activity,
      detail: this.detail,
      unseen: this.unseen,
    };
  }
}

// Markers set when the server itself is started from a Claude Code session or a
// VSCode terminal. Passing them down makes claude think it is a nested child
// session (e.g. transcripts disabled) or attached to an IDE it is not in.
const INHERITED_MARKERS = [
  /^CLAUDECODE$/,
  /^CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|EXECPATH|MESSAGING_SOCKET|MESSAGING_TOKEN|SESSION_ATTENDED|SESSION_ID|SSE_PORT)$/,
  /^CLAUDE_(EFFORT|PID)$/,
  /^AI_AGENT$/,
  /^TERM_PROGRAM(_VERSION)?$/,
  /^VSCODE_/,
  /^GIT_ASKPASS$/,
];

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !INHERITED_MARKERS.some((re) => re.test(key))) env[key] = value;
  }
  return env;
}

function claudeCommand(hookSettings: string | null): [string, string[] | string] {
  const command = process.env.AGENTHUB_CLAUDE ?? 'claude';
  if (process.platform === 'win32') {
    // `claude` is often an npm .cmd shim, which only cmd.exe can run. The command
    // line is passed pre-escaped: with /s, cmd strips the outer quotes and keeps
    // the inner ones around the settings path.
    const settings = hookSettings ? ` --settings "${hookSettings}"` : '';
    return [process.env.ComSpec ?? 'cmd.exe', `/d /s /c "${command}${settings}"`];
  }
  return [command, hookSettings ? ['--settings', hookSettings] : []];
}
