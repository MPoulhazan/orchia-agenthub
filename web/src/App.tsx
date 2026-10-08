import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Project, type SessionInfo } from './api';
import { useHub } from './useHub';
import { terminalThemes, useTheme } from './theme';
import { storage } from './storage';
import { Rail, Sidebar, type View } from './Sidebar';
import { CommandPalette, type PaletteMode } from './CommandPalette';
import { SessionPane } from './SessionPane';
import { needsAttention } from './status';
import { pageActive, useNotifications } from './notifications';

const SELECTED_KEY = 'agenthub.selectedSession';
const SIDEBAR_KEY = 'agenthub.sidebar';
const VIEW_KEY = 'agenthub.view';
const GRID_KEY = 'agenthub.grid';
const GRID_MAX = 6;
const GRID_AUTOFILL = 4;

function readGrid(): string[] {
  try {
    const value = JSON.parse(storage.get(GRID_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function App() {
  const { state, connected } = useHub();
  const theme = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(() => storage.get(SELECTED_KEY));
  const [sidebarOpen, setSidebarOpen] = useState(() => storage.get(SIDEBAR_KEY) !== 'closed');
  const [view, setViewState] = useState<View>(() => (storage.get(VIEW_KEY) === 'grid' ? 'grid' : 'focus'));
  const [gridIds, setGridIds] = useState<string[]>(readGrid);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const pendingId = useRef<string | null>(null);
  const lastProjectId = useRef<string | null>(null);

  const projects = state?.projects ?? [];
  // Sessions in sidebar order, which is also the Alt+1..9 order.
  const sessions = useMemo(() => {
    const order = new Map(projects.map((p, i) => [p.id, i]));
    return [...(state?.sessions ?? [])].sort(
      (a, b) => (order.get(a.projectId) ?? 0) - (order.get(b.projectId) ?? 0) || a.createdAt - b.createdAt,
    );
  }, [state]);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const selectedProject = projects.find((p) => p.id === selected?.projectId) ?? null;
  if (selectedProject) lastProjectId.current = selectedProject.id;
  const projectOf = (s: SessionInfo) => projects.find((p) => p.id === s.projectId) ?? null;

  const gridSessions = gridIds.map((id) => sessions.find((s) => s.id === id)).filter((s): s is SessionInfo => !!s);
  const terminalTheme = terminalThemes[theme.resolved];

  const refocus = () => setFocusKey((k) => k + 1);

  const select = (id: string | null) => {
    setSelectedId(id);
    storage.set(SELECTED_KEY, id);
  };

  const saveGrid = (ids: string[]) => {
    setGridIds(ids);
    storage.set(GRID_KEY, JSON.stringify(ids));
  };

  // Drop sessions that no longer exist from the saved grid once state is known.
  useEffect(() => {
    if (!state) return;
    const alive = gridIds.filter((id) => state.sessions.some((s) => s.id === id) || id === pendingId.current);
    if (alive.length !== gridIds.length) saveGrid(alive);
  }, [state]);

  // When the selected session disappears, fall back to a neighbour in the same project.
  useEffect(() => {
    if (!state || selected || !selectedId || selectedId === pendingId.current) return;
    const sibling = sessions.filter((s) => s.projectId === lastProjectId.current).at(-1);
    select(sibling?.id ?? null);
  }, [state, selected, selectedId]);

  const notify = useNotifications(sessions, projects, (id) => open(id));

  // Sessions on screen while the tab is in front count as seen.
  const visibleIds = view === 'grid' ? gridSessions.map((s) => s.id) : selected ? [selected.id] : [];
  const [pageTick, setPageTick] = useState(0);
  useEffect(() => {
    const bump = () => setPageTick((t) => t + 1);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', bump);
    return () => {
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', bump);
    };
  }, []);
  useEffect(() => {
    if (!pageActive()) return;
    for (const s of sessions) if (s.unseen && visibleIds.includes(s.id)) api.markSeen(s.id).catch(() => {});
  }, [state, visibleIds.join(), pageTick]);

  const attentionCount = sessions.filter(needsAttention).length;
  useEffect(() => {
    document.title = attentionCount ? `(${attentionCount}) AgentHub` : 'AgentHub';
  }, [attentionCount]);

  function setView(next: View) {
    // First time in an empty grid: show what is running instead of a blank screen.
    if (next === 'grid' && gridSessions.length === 0) {
      const running = sessions.filter((s) => s.status === 'running');
      const pick = selected ? [selected, ...running.filter((s) => s.id !== selected.id)] : running;
      saveGrid(pick.slice(0, GRID_AUTOFILL).map((s) => s.id));
    }
    setViewState(next);
    storage.set(VIEW_KEY, next);
    refocus();
  }

  function toggleGrid(id: string) {
    if (gridIds.includes(id)) saveGrid(gridIds.filter((x) => x !== id));
    else if (gridSessions.length < GRID_MAX) saveGrid([...gridSessions.map((s) => s.id), id]);
  }

  /** Show a session: in grid view it joins the grid (if there is room), otherwise it takes the focus view. */
  function open(id: string) {
    select(id);
    if (view === 'grid' && !gridIds.includes(id)) {
      if (gridSessions.length < GRID_MAX) saveGrid([...gridSessions.map((s) => s.id), id]);
      else setView('focus');
    }
    refocus();
  }

  function maximize(id: string) {
    select(id);
    setView('focus');
  }

  const toggleSidebar = () => {
    setSidebarOpen((isOpen) => {
      storage.set(SIDEBAR_KEY, isOpen ? 'closed' : 'open');
      return !isOpen;
    });
  };

  async function newSession(project: Project) {
    const session = await api.createSession(project.id);
    pendingId.current = session.id;
    open(session.id);
  }

  function openProject(project: Project) {
    const latest = sessions.filter((s) => s.projectId === project.id).at(-1);
    if (latest) open(latest.id);
    else newSession(project);
  }

  async function addPath(path: string) {
    const project = await api.addProject(path);
    openProject(project);
  }

  function closePalette() {
    setPalette(null);
    refocus();
  }

  // Global shortcuts, captured before the terminal sees the keystroke.
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcuts.current = (e) => {
    const key = e.key.toLowerCase();
    const alt = e.altKey && !e.ctrlKey && !e.metaKey;
    let handled = true;
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'k') {
      palette ? closePalette() : setPalette('root');
    } else if (alt && key === 'n') {
      const project = selectedProject ?? projects.find((p) => p.id === lastProjectId.current);
      project ? newSession(project) : setPalette('root');
    } else if (alt && key === 'g') {
      setView(view === 'grid' ? 'focus' : 'grid');
    } else if (alt && /^Digit[1-9]$/.test(e.code)) {
      const target = sessions[Number(e.code.slice(5)) - 1];
      if (target) open(target.id);
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="app">
      {sidebarOpen ? (
        <Sidebar
          view={view}
          gridIds={view === 'grid' ? gridIds : []}
          onSetView={setView}
          onCollapse={toggleSidebar}
          projects={projects}
          sessions={sessions}
          selectedId={selected?.id ?? null}
          connected={connected}
          themePref={theme.pref}
          onSelect={(s) => open(s.id)}
          onNewSession={newSession}
          onCloseSession={(s) => api.closeSession(s.id)}
          onRenameSession={(s, name) => api.renameSession(s.id, name)}
          onRemoveProject={(p) => api.removeProject(p.id)}
          onOpenPalette={() => setPalette('root')}
          onAddProject={() => setPalette('root')}
          onSetTheme={theme.setPref}
          notify={notify.state}
          onToggleNotify={notify.toggle}
        />
      ) : (
        <Rail
          view={view}
          projects={projects}
          sessions={sessions}
          selectedId={selected?.id ?? null}
          onSetView={setView}
          onExpand={toggleSidebar}
          onOpenPalette={() => setPalette('root')}
          onSelect={(s) => open(s.id)}
        />
      )}

      <main className="main">
        {!state ? null : view === 'grid' ? (
          gridSessions.length ? (
            <div className="grid" data-count={gridSessions.length}>
              {gridSessions.map((s) => (
                <SessionPane
                  key={s.id}
                  compact
                  session={s}
                  project={projectOf(s)}
                  theme={terminalTheme}
                  active={s.id === selected?.id}
                  focusKey={s.id === selected?.id ? focusKey : undefined}
                  onActivate={() => s.id !== selectedId && select(s.id)}
                  onMaximize={() => maximize(s.id)}
                  onToggleGrid={() => toggleGrid(s.id)}
                />
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="empty-body">
                <h1>Nothing in the grid yet</h1>
                <p className="muted">
                  Click sessions in the sidebar to add them here, up to {GRID_MAX}. Start a new one with <kbd>Alt N</kbd>.
                </p>
              </div>
            </div>
          )
        ) : selected ? (
          <SessionPane
            session={selected}
            project={selectedProject}
            theme={terminalTheme}
            focusKey={focusKey}
            inGrid={gridIds.includes(selected.id)}
            onToggleGrid={() => toggleGrid(selected.id)}
          />
        ) : (
          <EmptyState projects={projects} onOpenPalette={() => setPalette('root')} onOpenProject={openProject} />
        )}
      </main>

      {palette && (
        <CommandPalette
          initialMode={palette}
          projects={projects}
          currentProject={selectedProject}
          view={view}
          onClose={closePalette}
          onOpenProject={openProject}
          onAddPath={addPath}
          onNewSession={newSession}
          onSetTheme={theme.setPref}
          onSetView={setView}
          onToggleSidebar={toggleSidebar}
        />
      )}
    </div>
  );
}

function EmptyState(props: { projects: Project[]; onOpenPalette: () => void; onOpenProject: (p: Project) => void }) {
  return (
    <div className="empty">
      <div className="empty-body">
        <h1>{props.projects.length ? 'Pick up where you left off' : 'Add your first project'}</h1>
        <p className="muted">
          Each project runs its own Claude Code sessions. Open one, or search with <kbd>Ctrl K</kbd>.
        </p>
        {props.projects.length > 0 && (
          <div className="empty-list">
            {props.projects.map((p) => (
              <button key={p.id} className="empty-item" onClick={() => props.onOpenProject(p)}>
                <span className="empty-item-name">{p.name}</span>
                <span className="empty-item-path">{p.path}</span>
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-primary" onClick={props.onOpenPalette}>
          {props.projects.length ? 'Open another project' : 'Add project'}
        </button>
      </div>
    </div>
  );
}

