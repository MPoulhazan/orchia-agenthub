export interface SessionInfo {
  id: string;
  cwd: string;
  status: 'running' | 'exited';
  exitCode: number | null;
  createdAt: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  listSessions: () => request<SessionInfo[]>('/api/sessions'),
  createSession: (cwd: string, cols?: number, rows?: number) =>
    request<SessionInfo>('/api/sessions', { method: 'POST', body: JSON.stringify({ cwd, cols, rows }) }),
  deleteSession: (id: string) => request<{ ok: true }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  streamUrl: (id: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sessions/${id}/stream`,
};
