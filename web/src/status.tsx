import type { SessionInfo } from './api';

export type Status = 'starting' | 'working' | 'waiting' | 'done' | 'idle' | 'paused' | 'exited';

export function statusOf(s: SessionInfo): Status {
  if (s.status === 'exited') return 'exited';
  if (s.status === 'suspended') return 'paused';
  if (s.activity === 'waiting') return 'waiting';
  if (s.activity === 'working') return 'working';
  if (s.activity === 'idle') return s.unseen ? 'done' : 'idle';
  return 'starting';
}

export const statusLabel: Record<Status, string> = {
  starting: 'Ready',
  working: 'Working',
  waiting: 'Needs you',
  done: 'Done',
  idle: 'Idle',
  paused: 'Paused',
  exited: 'Ended',
};

/** Sessions that want the user's attention: blocked on them, or finished and not looked at yet. */
export function needsAttention(s: SessionInfo): boolean {
  const status = statusOf(s);
  return status === 'waiting' || status === 'done';
}

export function StatusDot({ session }: { session: SessionInfo }) {
  const status = statusOf(session);
  return <span className="status-dot" data-status={status} title={session.detail ?? statusLabel[status]} />;
}
