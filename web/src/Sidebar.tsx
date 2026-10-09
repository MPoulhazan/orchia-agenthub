import { useState } from 'react';
import { Bell, BellOff, ChevronRight, LayoutGrid, Monitor, Moon, MoreHorizontal, PanelLeft, Plus, Search, Square, Sun, X } from 'lucide-react';
import type { Project, SessionInfo } from './api';
import type { ThemePref } from './theme';
import { ConfirmButton, Menu } from './ui';
import { storage } from './storage';
import { StatusDot, needsAttention, statusOf } from './status';
import type { NotifyState } from './notifications';

export type View = 'focus' | 'grid';

interface Props {
  view: View;
  gridIds: string[];
  onSetView: (view: View) => void;
  onCollapse: () => void;
  projects: Project[];
  sessions: SessionInfo[];
  selectedId: string | null;
  connected: boolean;
  themePref: ThemePref;
  onSelect: (session: SessionInfo) => void;
  onNewSession: (project: Project) => void;
  onCloseSession: (session: SessionInfo) => void;
  onRenameSession: (session: SessionInfo, name: string) => void;
  onRemoveProject: (project: Project) => void;
  onOpenPalette: () => void;
  onAddProject: () => void;
  onSetTheme: (pref: ThemePref) => void;
  notify: NotifyState;
  onToggleNotify: () => void;
}

const COLLAPSED_KEY = 'agenthub.collapsedProjects';

export function Sidebar(props: Props) {
  const { projects, sessions, selectedId } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(JSON.parse(storage.get(COLLAPSED_KEY) ?? '[]')),
  );

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    setCollapsed(next);
    storage.set(COLLAPSED_KEY, JSON.stringify([...next]));
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="wordmark">
          <span className="glyph" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          AgentHub
        </span>
        <span className="pane-spacer" />
        <ViewSwitch view={props.view} onSetView={props.onSetView} />
        <button className="icon-btn" title="Collapse sidebar" onClick={props.onCollapse}>
          <PanelLeft size={15} />
        </button>
      </div>

      <button className="search-btn" onClick={props.onOpenPalette}>
        <Search size={14} />
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>

      <Attention projects={projects} sessions={sessions} selectedId={selectedId} onSelect={props.onSelect} />

      <div className="sidebar-section">
        <span>Projects</span>
        <button className="icon-btn" title="Add project" onClick={props.onAddProject}>
          <Plus size={14} />
        </button>
      </div>

      <nav className="tree">
        {projects.length === 0 && (
          <button className="tree-empty" onClick={props.onAddProject}>
            Add a project to get started
          </button>
        )}
        {projects.map((project) => {
          const own = sessions.filter((s) => s.projectId === project.id);
          const isCollapsed = collapsed.has(project.id);
          const running = own.filter((s) => s.status === 'running').length;
          return (
            <div key={project.id} className="tree-group">
              <div className="tree-project" onClick={() => toggle(project.id)} title={project.path}>
                <ChevronRight size={13} className={`chevron ${isCollapsed ? '' : 'is-open'}`} />
                <span className="tree-label">{project.name}</span>
                {isCollapsed && running > 0 && <span className="tree-count">{running}</span>}
                <span className="tree-actions">
                  <button
                    className="icon-btn"
                    title="New session"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onNewSession(project);
                    }}
                  >
                    <Plus size={14} />
                  </button>
                  <Menu
                    title="More"
                    trigger={<MoreHorizontal size={14} />}
                    items={[
                      { label: 'New session', onSelect: () => props.onNewSession(project) },
                      { label: 'Copy path', onSelect: () => navigator.clipboard.writeText(project.path) },
                      {
                        label: running ? `Remove project (ends ${running} session${running > 1 ? 's' : ''})` : 'Remove project',
                        danger: true,
                        onSelect: () => props.onRemoveProject(project),
                      },
                    ]}
                  />
                </span>
              </div>

              {!isCollapsed &&
                own.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={session.id === selectedId}
                    inGrid={props.gridIds.includes(session.id)}
                    onSelect={() => props.onSelect(session)}
                    onClose={() => props.onCloseSession(session)}
                    onRename={(name) => props.onRenameSession(session, name)}
                  />
                ))}
              {!isCollapsed && own.length === 0 && (
                <button className="tree-new" onClick={() => props.onNewSession(project)}>
                  <Plus size={13} />
                  New session
                </button>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        {props.connected ? <span /> : <span className="offline">Server offline · reconnecting</span>}
        <span className="pane-spacer" />
        <button
          className="icon-btn"
          data-on={props.notify === 'on'}
          title={
            props.notify === 'blocked'
              ? 'Notifications are blocked in the browser settings'
              : props.notify === 'on'
                ? 'Desktop notifications on'
                : 'Turn on desktop notifications'
          }
          onClick={props.onToggleNotify}
        >
          {props.notify === 'on' ? <Bell size={14} /> : <BellOff size={14} />}
        </button>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {(
            [
              ['system', Monitor, 'System theme'],
              ['light', Sun, 'Light theme'],
              ['dark', Moon, 'Dark theme'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={props.themePref === value}
              title={label}
              onClick={() => props.onSetTheme(value)}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

/** Sessions waiting on the user or finished unseen, above the project tree. */
function Attention(props: {
  projects: Project[];
  sessions: SessionInfo[];
  selectedId: string | null;
  onSelect: (s: SessionInfo) => void;
}) {
  const waiting = props.sessions.filter((s) => statusOf(s) === 'waiting');
  const done = props.sessions.filter((s) => statusOf(s) === 'done');
  const list = [...waiting, ...done].filter(needsAttention);
  if (!list.length) return null;
  const projectName = (id: string) => props.projects.find((p) => p.id === id)?.name ?? '';

  return (
    <>
      <div className="sidebar-section">
        <span>Needs you</span>
        <span className="section-count">{list.length}</span>
      </div>
      <div className="attention">
        {list.map((s) => (
          <button key={s.id} className="attention-row" data-selected={s.id === props.selectedId} onClick={() => props.onSelect(s)}>
            <span className="attention-title">
              {statusOf(s) === 'waiting' ? <span className="mark">Needs you</span> : <span className="mark" data-tone="done">Done</span>}
              <b>{s.name}</b>
              <span className="attention-project">· {projectName(s.projectId)}</span>
            </span>
            <span className="attention-detail">
              {statusOf(s) === 'waiting' ? (s.detail ?? 'Needs your input') : (s.detail ?? 'Finished')}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function ViewSwitch({ view, onSetView, vertical }: { view: View; onSetView: (v: View) => void; vertical?: boolean }) {
  return (
    <div className="segmented" data-vertical={vertical} role="radiogroup" aria-label="Layout">
      <button role="radio" aria-checked={view === 'focus'} title="Focus view (Alt G)" onClick={() => onSetView('focus')}>
        <Square size={12} />
      </button>
      <button role="radio" aria-checked={view === 'grid'} title="Grid view (Alt G)" onClick={() => onSetView('grid')}>
        <LayoutGrid size={13} />
      </button>
    </div>
  );
}

/** Collapsed sidebar: layout controls and one dot per session. */
export function Rail(props: {
  view: View;
  projects: Project[];
  sessions: SessionInfo[];
  selectedId: string | null;
  onSetView: (v: View) => void;
  onExpand: () => void;
  onOpenPalette: () => void;
  onSelect: (s: SessionInfo) => void;
}) {
  const projectName = (id: string) => props.projects.find((p) => p.id === id)?.name ?? '';
  return (
    <aside className="rail">
      <button className="icon-btn" title="Expand sidebar" onClick={props.onExpand}>
        <PanelLeft size={15} />
      </button>
      <button className="icon-btn" title="Search (Ctrl K)" onClick={props.onOpenPalette}>
        <Search size={15} />
      </button>
      <ViewSwitch view={props.view} onSetView={props.onSetView} vertical />
      <div className="rail-sessions">
        {props.sessions.map((s, i) => (
          <button
            key={s.id}
            className="rail-session"
            data-selected={s.id === props.selectedId}
            title={`${projectName(s.projectId)} / ${s.name}${i < 9 ? `  (Alt ${i + 1})` : ''}`}
            onClick={() => props.onSelect(s)}
          >
            <StatusDot session={s} />
          </button>
        ))}
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  selected,
  inGrid,
  onSelect,
  onClose,
  onRename,
}: {
  session: SessionInfo;
  selected: boolean;
  inGrid: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="tree-session" data-selected={selected} onClick={onSelect} onDoubleClick={() => setEditing(true)}>
      <StatusDot session={session} />
      {editing ? (
        <input
          className="rename-input"
          autoFocus
          defaultValue={session.name}
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== session.name) onRename(name);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = session.name;
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span className="tree-label">{session.name}</span>
      )}
      {!editing && inGrid && (
        <span className="tree-grid-mark" title="In grid">
          <LayoutGrid size={11} />
        </span>
      )}
      {!editing && session.status === 'running' && (
        <ConfirmButton className="icon-btn tree-close" title="End session" confirmLabel="End" onConfirm={onClose}>
          <X size={13} />
        </ConfirmButton>
      )}
      {!editing && session.status === 'exited' && (
        <button
          className="icon-btn tree-close"
          title="Close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
