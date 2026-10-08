import { useEffect, useState, type FormEvent } from 'react';
import { api, type SessionInfo } from './api';
import { TerminalView } from './TerminalView';

const LAST_CWD_KEY = 'agenthub.lastCwd';

function readLastCwd(): string {
  try {
    return localStorage.getItem(LAST_CWD_KEY) ?? '';
  } catch {
    return '';
  }
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ready, setReady] = useState(false);

  // Reattach to the latest session after a page reload.
  useEffect(() => {
    api
      .listSessions()
      .then((list) => setSession(list.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  async function stop() {
    if (!session) return;
    await api.deleteSession(session.id).catch(() => {});
    setSession(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">AgentHub</span>
      </header>

      <main className="main">
        {!ready ? null : session ? (
          <section className="pane">
            <div className="pane-bar">
              <span className={`status-dot ${session.status}`} />
              <span className="pane-title">{folderName(session.cwd)}</span>
              <span className="pane-path">{session.cwd}</span>
              <span className="pane-spacer" />
              {session.status === 'exited' && (
                <span className="pane-meta">Exited{session.exitCode !== null ? ` (${session.exitCode})` : ''}</span>
              )}
              <button className="btn btn-ghost" onClick={stop}>
                {session.status === 'exited' ? 'Close' : 'Stop'}
              </button>
            </div>
            <TerminalView
              sessionId={session.id}
              onExit={(code) => setSession((s) => s && { ...s, status: 'exited', exitCode: code })}
            />
          </section>
        ) : (
          <StartForm onStarted={setSession} />
        )}
      </main>
    </div>
  );
}

function StartForm({ onStarted }: { onStarted: (s: SessionInfo) => void }) {
  const [cwd, setCwd] = useState(readLastCwd);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api.createSession(cwd);
      try {
        localStorage.setItem(LAST_CWD_KEY, cwd);
      } catch {}
      onStarted(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="start" onSubmit={submit}>
      <h1>Start a Claude session</h1>
      <p className="muted">Pick a project folder. Claude runs there, just like in your terminal.</p>
      <div className="field-row">
        <input
          className="input"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="C:\path\to\project"
          spellCheck={false}
          autoFocus
        />
        <button className="btn btn-primary" disabled={busy || !cwd.trim()}>
          {busy ? 'Starting…' : 'Start'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
