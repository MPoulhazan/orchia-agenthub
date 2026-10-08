import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Session } from './session.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.AGENTHUB_PORT ?? 4317);
const DEV_WEB_PORT = 5173;
const STATIC_DIR = fileURLToPath(new URL('../dist', import.meta.url));

const sessions = new Map<string, Session>();

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
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected application/json');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path === '/api/sessions' && req.method === 'GET') {
    return sendJson(res, 200, [...sessions.values()].map((s) => s.info()));
  }

  if (path === '/api/sessions' && req.method === 'POST') {
    const body = await readJson(req);
    const cwd = typeof body.cwd === 'string' ? resolve(body.cwd.trim()) : '';
    if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return sendJson(res, 400, { error: 'Folder not found' });
    }
    const session = new Session(cwd, body.cols, body.rows);
    sessions.set(session.id, session);
    return sendJson(res, 201, session.info());
  }

  const match = path.match(/^\/api\/sessions\/([\w-]+)$/);
  if (match && req.method === 'DELETE') {
    const session = sessions.get(match[1]);
    if (!session) return sendJson(res, 404, { error: 'Session not found' });
    session.dispose();
    sessions.delete(session.id);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: 'Not found' });
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function serveStatic(res: http.ServerResponse, path: string) {
  let file = normalize(join(STATIC_DIR, path));
  if (!file.startsWith(STATIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) return sendJson(res, 404, { error: 'UI not built. Run `npm run dev` or `npm run build`.' });
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!path.startsWith('/api/')) return serveStatic(res, path);
  if (!isTrusted(req)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    await handleApi(req, res, path);
  } catch (err) {
    sendJson(res, 400, { error: (err as Error).message });
  }
});

// Client -> server: {t:'in', d} keystrokes, {t:'resize', cols, rows}.
// Server -> client: {t:'out', d} output, {t:'exit', code}.
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const match = path.match(/^\/api\/sessions\/([\w-]+)\/stream$/);
  const session = match ? sessions.get(match[1]) : undefined;
  if (!isTrusted(req) || !session) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, session));
});

function attach(ws: WebSocket, session: Session) {
  const send = (msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  send({ t: 'out', d: session.snapshot() });
  if (session.status === 'exited') send({ t: 'exit', code: session.exitCode });

  const onData = (d: string) => send({ t: 'out', d });
  const onExit = (code: number) => send({ t: 'exit', code });
  session.on('data', onData);
  session.on('exit', onExit);

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
    session.off('exit', onExit);
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
