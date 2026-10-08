import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Session } from './session.ts';
import { ProjectStore } from './projects.ts';
import { claudeProjectSuggestions, homeFolder, listFolder } from './folders.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.AGENTHUB_PORT ?? 4317);
const DEV_WEB_PORT = 5173;
const STATIC_DIR = fileURLToPath(new URL('../dist', import.meta.url));

const projects = new ProjectStore();
const sessions = new Map<string, Session>();

// ---- Live state -------------------------------------------------------------
// Every client keeps one events socket open and receives the whole state on
// each change. The state is tiny, so this beats keeping diffs in sync.

const eventClients = new Set<WebSocket>();

function state() {
  return {
    t: 'state',
    projects: projects.list(),
    sessions: [...sessions.values()].map((s) => s.info()),
  };
}

function broadcast() {
  const msg = JSON.stringify(state());
  for (const ws of eventClients) if (ws.readyState === ws.OPEN) ws.send(msg);
}

function createSession(projectId: string, cols?: number, rows?: number): Session {
  const project = projects.get(projectId);
  if (!project) throw new HttpError(404, 'Project not found');
  const taken = new Set([...sessions.values()].filter((s) => s.projectId === projectId).map((s) => s.name));
  let n = 1;
  while (taken.has(`Session ${n}`)) n++;
  const session = new Session(project.id, project.path, `Session ${n}`, cols, rows);
  session.on('change', broadcast);
  sessions.set(session.id, session);
  broadcast();
  return session;
}

function closeSession(session: Session) {
  session.dispose();
  sessions.delete(session.id);
}

// ---- HTTP -------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// The server spawns processes, so only accept requests coming from our own UI.
// Checking Host blocks DNS rebinding; checking Origin blocks cross-site requests.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const ALLOWED_PORTS = new Set([String(PORT), String(DEV_WEB_PORT)]);

function isTrusted(req: http.IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ''))) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return LOCAL_HOSTS.has(url.hostname) && ALLOWED_PORTS.has(url.port);
  } catch {
    return false;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Expected application/json');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function findSession(id: string): Session {
  const session = sessions.get(id);
  if (!session) throw new HttpError(404, 'Session not found');
  return session;
}

type Handler = (req: http.IncomingMessage, url: URL, params: string[]) => Promise<unknown> | unknown;

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/state$/, () => state()],

  ['POST', /^\/api\/projects$/, async (req) => {
    const body = await readJson(req);
    try {
      const project = projects.add(String(body.path ?? ''));
      broadcast();
      return project;
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }],
  ['DELETE', /^\/api\/projects\/([\w-]+)$/, (_req, _url, [id]) => {
    for (const s of sessions.values()) if (s.projectId === id) closeSession(s);
    projects.remove(id);
    broadcast();
    return { ok: true };
  }],

  ['POST', /^\/api\/sessions$/, async (req) => {
    const body = await readJson(req);
    return createSession(String(body.projectId ?? ''), body.cols, body.rows).info();
  }],
  ['PATCH', /^\/api\/sessions\/([\w-]+)$/, async (req, _url, [id]) => {
    const body = await readJson(req);
    const name = String(body.name ?? '').trim().slice(0, 60);
    if (!name) throw new HttpError(400, 'Name is required');
    findSession(id).rename(name);
    return { ok: true };
  }],
  ['POST', /^\/api\/sessions\/([\w-]+)\/restart$/, (_req, _url, [id]) => {
    findSession(id).restart();
    return { ok: true };
  }],
  ['DELETE', /^\/api\/sessions\/([\w-]+)$/, (_req, _url, [id]) => {
    closeSession(findSession(id));
    broadcast();
    return { ok: true };
  }],

  ['GET', /^\/api\/suggestions$/, () => claudeProjectSuggestions()],
  ['GET', /^\/api\/folders$/, (_req, url) => {
    const path = url.searchParams.get('path');
    try {
      return listFolder(path === null ? homeFolder() : path || null);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }],
];

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  for (const [method, pattern, handler] of routes) {
    const match = url.pathname.match(pattern);
    if (match && req.method === method) return sendJson(res, 200, await handler(req, url, match.slice(1)));
  }
  throw new HttpError(404, 'Not found');
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res: http.ServerResponse, path: string) {
  let file = normalize(join(STATIC_DIR, path));
  if (!file.startsWith(STATIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) return sendJson(res, 404, { error: 'UI not built. Run `npm run dev` or `npm start`.' });
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
  if (!isTrusted(req)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    await handleApi(req, res, url);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 400;
    sendJson(res, status, { error: (err as Error).message });
  }
});

// ---- WebSockets ---------------------------------------------------------------
// /api/events: server -> client {t:'state', projects, sessions}.
// /api/sessions/:id/stream:
//   client -> server {t:'in', d} keystrokes, {t:'resize', cols, rows}
//   server -> client {t:'out', d} output, {t:'reset'} before a restarted process.

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!isTrusted(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  if (path === '/api/events') return wss.handleUpgrade(req, socket, head, attachEvents);

  const match = path.match(/^\/api\/sessions\/([\w-]+)\/stream$/);
  const session = match ? sessions.get(match[1]) : undefined;
  if (!session) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => attachStream(ws, session));
});

function attachEvents(ws: WebSocket) {
  eventClients.add(ws);
  ws.send(JSON.stringify(state()));
  ws.on('close', () => eventClients.delete(ws));
}

function attachStream(ws: WebSocket, session: Session) {
  const send = (msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  send({ t: 'out', d: session.snapshot() });

  const onData = (d: string) => send({ t: 'out', d });
  const onReset = () => send({ t: 'reset' });
  session.on('data', onData);
  session.on('reset', onReset);

  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.t === 'in' && typeof msg.d === 'string') session.write(msg.d);
    if (msg.t === 'resize') session.resize(Math.floor(msg.cols), Math.floor(msg.rows));
  });

  ws.on('close', () => {
    session.off('data', onData);
    session.off('reset', onReset);
  });
}

function shutdown() {
  for (const session of sessions.values()) session.dispose();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`AgentHub server on http://${HOST}:${PORT}`);
});
