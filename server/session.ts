import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IPty } from '@lydell/node-pty';

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

  private proc!: IPty;
  private mirror!: InstanceType<typeof HeadlessTerminal>;
  private serializer!: InstanceType<typeof SerializeAddon>;

  constructor(
    readonly projectId: string,
    readonly cwd: string,
    public name: string,
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

    const [file, args] = claudeCommand();
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: { ...cleanEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
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

  rename(name: string) {
    this.name = name;
    this.emit('change');
  }

  write(data: string) {
    if (this.status === 'running') this.proc.write(data);
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

function claudeCommand(): [string, string[]] {
  const override = process.env.AGENTHUB_CLAUDE;
  const command = override ?? 'claude';
  // On Windows `claude` is often an npm .cmd shim, which only cmd.exe can run.
  if (process.platform === 'win32') return [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command]];
  return [command, []];
}
