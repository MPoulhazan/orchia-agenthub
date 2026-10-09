export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

export interface SessionInfo {
  id: string;
  projectId: string;
  name: string;
  cwd: string;
  status: 'running' | 'exited' | 'suspended';
  exitCode: number | null;
  endedAt: number | null;
  createdAt: number;
  activity: 'starting' | 'working' | 'waiting' | 'idle';
  detail: string | null;
  unseen: boolean;
  model: string | null;
  modelChoice: string | null;
  effortChoice: string | null;
  /** A permission request that can be answered from AgentHub: "Run" + `npm test`. */
  permission: { id: string; tool: string; verb: string; target: string } | null;
}

export interface Inspection {
  /** From Claude Code's status line; null until it first reports. */
  usage: {
    costUsd: number | null;
    contextUsed: number | null;
    contextSize: number | null;
    apiMs: number | null;
    linesAdded: number | null;
    linesRemoved: number | null;
  } | null;
  plan: { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }[];
  turns: number;
  /** null outside a git repository. */
  git: {
    branch: string | null;
    ahead: number | null;
    behind: number | null;
    files: { path: string; added: number | null; removed: number | null; isNew: boolean }[];
    fileCount: number;
    added: number;
    removed: number;
  } | null;
}

export interface Suggestion {
  name: string;
  path: string;
  lastUsed: number;
}

export interface FolderListing {
  path: string | null;
  parent: string | null;
  dirs: { name: string; path: string }[];
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

export const api = {
  addProject: (path: string) => request<Project>('/api/projects', 'POST', { path }),
  removeProject: (id: string) => request('/api/projects/' + id, 'DELETE'),

  createSession: (projectId: string) => request<SessionInfo>('/api/sessions', 'POST', { projectId }),
  renameSession: (id: string, name: string) => request(`/api/sessions/${id}`, 'PATCH', { name }),
  markSeen: (id: string) => request(`/api/sessions/${id}/seen`, 'POST'),
  configureSession: (id: string, model: string | null, effort: string | null) =>
    request(`/api/sessions/${id}/config`, 'POST', { model, effort }),
  resumeSession: (id: string) => request(`/api/sessions/${id}/resume`, 'POST'),
  /** Keeps the conversation unless `fresh`. */
  restartSession: (id: string, fresh = false) => request(`/api/sessions/${id}/restart`, 'POST', { fresh }),
  closeSession: (id: string) => request(`/api/sessions/${id}`, 'DELETE'),
  answerPermission: (id: string, permissionId: string, allow: boolean) =>
    request(`/api/sessions/${id}/permission`, 'POST', { id: permissionId, allow }),
  inspect: (id: string) => request<Inspection>(`/api/sessions/${id}/inspect`),

  suggestions: () => request<Suggestion[]>('/api/suggestions'),
  /** No path: home folder. Empty path: drive list. */
  folders: (path?: string) =>
    request<FolderListing>(path === undefined ? '/api/folders' : `/api/folders?path=${encodeURIComponent(path)}`),

  eventsUrl: () => `${wsBase()}/api/events`,
  streamUrl: (id: string) => `${wsBase()}/api/sessions/${id}/stream`,
};
