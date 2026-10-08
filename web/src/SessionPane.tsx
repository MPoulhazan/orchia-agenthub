import type { ITheme } from '@xterm/xterm';
import { LayoutGrid, Maximize2, RotateCcw, X } from 'lucide-react';
import { api, type Project, type SessionInfo } from './api';
import { TerminalView } from './TerminalView';
import { ConfirmButton } from './ui';
import { StatusDot, statusLabel, statusOf } from './status';

interface Props {
  session: SessionInfo;
  project: Project | null;
  theme: ITheme;
  /** Grid cell: tighter header, smaller font, actions to maximize or leave the grid. */
  compact?: boolean;
  active?: boolean;
  focusKey?: number;
  inGrid?: boolean;
  onActivate?: () => void;
  onMaximize?: () => void;
  onToggleGrid?: () => void;
}

export function SessionPane({ session, project, theme, compact, active, focusKey, inGrid, onActivate, onMaximize, onToggleGrid }: Props) {
  const exited = session.status === 'exited';

  return (
    <section className="pane" data-compact={compact} data-active={active} onFocusCapture={onActivate} onMouseDown={onActivate}>
      <header className="pane-bar" onDoubleClick={compact ? onMaximize : undefined}>
        {compact && <StatusDot session={session} />}
        <div className="crumbs">
          <span className="crumb-project">{project?.name}</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-session">{session.name}</span>
        </div>
        {!compact && (
          <span className="pane-path" title={session.cwd}>
            {session.cwd}
          </span>
        )}
        <StatusText session={session} compact={compact} />
        <span className="pane-spacer" />

        <button className="icon-btn" title="Restart session" onClick={() => api.restartSession(session.id)}>
          <RotateCcw size={14} />
        </button>
        {compact ? (
          <>
            <button className="icon-btn" title="Focus this session" onClick={onMaximize}>
              <Maximize2 size={14} />
            </button>
            <button className="icon-btn" title="Remove from grid" onClick={onToggleGrid}>
              <X size={15} />
            </button>
          </>
        ) : (
          <>
            <button
              className="icon-btn"
              title={inGrid ? 'Remove from grid' : 'Add to grid'}
              data-on={inGrid}
              onClick={onToggleGrid}
            >
              <LayoutGrid size={14} />
            </button>
            {exited ? (
              <button className="icon-btn" title="Close" onClick={() => api.closeSession(session.id)}>
                <X size={15} />
              </button>
            ) : (
              <ConfirmButton
                className="icon-btn"
                title="End session"
                confirmLabel="End session"
                onConfirm={() => api.closeSession(session.id)}
              >
                <X size={15} />
              </ConfirmButton>
            )}
          </>
        )}
      </header>

      <TerminalView
        sessionId={session.id}
        theme={theme}
        focusKey={focusKey}
        fontSize={compact ? 12 : 13}
        autoFocus={!compact || active}
      />

      {exited && !compact && (
        <div className="ended-bar">
          <span>Session ended{session.exitCode !== null ? ` with code ${session.exitCode}` : ''}</span>
          <span className="pane-spacer" />
          <button className="btn btn-ghost" onClick={() => api.closeSession(session.id)}>
            Close
          </button>
          <button className="btn btn-secondary" onClick={() => api.restartSession(session.id)}>
            Restart
          </button>
        </div>
      )}
    </section>
  );
}

function StatusText({ session, compact }: { session: SessionInfo; compact?: boolean }) {
  const status = statusOf(session);
  if (status === 'idle' || status === 'starting') return null;
  const text = !compact && session.detail && status === 'waiting' ? `${statusLabel[status]} · ${session.detail}` : statusLabel[status];
  return (
    <span className="pane-status" data-status={status} title={session.detail ?? undefined}>
      {text}
    </span>
  );
}
