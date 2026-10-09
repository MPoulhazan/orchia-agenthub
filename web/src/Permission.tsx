import { useState, type MouseEvent } from 'react';
import { api, type SessionInfo } from './api';

type Permission = NonNullable<SessionInfo['permission']>;

/** "Run `npm test -- scrapers/indeed`" */
export function PermissionText({ permission }: { permission: Permission }) {
  return (
    <>
      {permission.verb} {permission.target ? <code>{permission.target}</code> : permission.tool}
    </>
  );
}

/** Allow / Deny for the session's pending permission. Claude Code's own prompt stays answerable too. */
export function PermissionButtons({ session, small }: { session: SessionInfo; small?: boolean }) {
  const permission = session.permission;
  const [sent, setSent] = useState<string | null>(null);
  if (!permission) return null;
  const busy = sent === permission.id;

  const answer = (allow: boolean) => (e: MouseEvent) => {
    e.stopPropagation();
    setSent(permission.id);
    // A 409 means it was answered in the terminal first: the next state update clears it.
    api.answerPermission(session.id, permission.id, allow).catch(() => {});
  };

  return (
    <span className="perm-acts" data-small={small}>
      <button className="btn btn-primary" disabled={busy} title={`Allow ${permission.tool} once`} onClick={answer(true)}>
        Allow
      </button>
      <button className="btn btn-secondary" disabled={busy} title="Deny and stop Claude's turn" onClick={answer(false)}>
        Deny
      </button>
    </span>
  );
}
