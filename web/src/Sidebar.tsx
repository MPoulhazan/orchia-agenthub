import { useState } from 'react';
import { ChevronRight, Monitor, Moon, MoreHorizontal, Plus, Search, Sun, X } from 'lucide-react';
import type { Project, SessionInfo } from './api';
import type { ThemePref } from './theme';
import { ConfirmButton, Menu } from './ui';
import { storage } from './storage';

interface Props {
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
        <span className="wordmark">AgentHub</span>
      </div>

      <button className="search-btn" onClick={props.onOpenPalette}>
        <Search size={14} />
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>

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

function SessionRow({
  session,
  selected,
  onSelect,
  onClose,
  onRename,
}: {
  session: SessionInfo;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="tree-session" data-selected={selected} onClick={onSelect} onDoubleClick={() => setEditing(true)}>
      <span className={`status-dot ${session.status}`} />
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
