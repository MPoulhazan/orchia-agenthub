import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeft, RotateCcw, X } from 'lucide-react';
import { api, type Project } from './api';
import { useHub } from './useHub';
import { terminalThemes, useTheme } from './theme';
import { storage } from './storage';
import { Sidebar } from './Sidebar';
import { CommandPalette, type PaletteMode } from './CommandPalette';
import { TerminalView } from './TerminalView';
import { ConfirmButton } from './ui';

const SELECTED_KEY = 'agenthub.selectedSession';
const SIDEBAR_KEY = 'agenthub.sidebar';

export function App() {
  const { state, connected } = useHub();
  const theme = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(() => storage.get(SELECTED_KEY));
  const [sidebarOpen, setSidebarOpen] = useState(() => storage.get(SIDEBAR_KEY) !== 'closed');
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

  const select = (id: string | null) => {
    setSelectedId(id);
    storage.set(SELECTED_KEY, id);
  };

  // When the selected session disappears, fall back to a neighbour in the same project.
  useEffect(() => {
    if (!state || selected || !selectedId || selectedId === pendingId.current) return;
    const sibling = sessions.filter((s) => s.projectId === lastProjectId.current).at(-1);
    select(sibling?.id ?? null);
  }, [state, selected, selectedId]);

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      storage.set(SIDEBAR_KEY, open ? 'closed' : 'open');
      return !open;
    });
  };

  async function newSession(project: Project) {
    const session = await api.createSession(project.id);
    pendingId.current = session.id;
    select(session.id);
  }

  function openProject(project: Project) {
    const latest = sessions.filter((s) => s.projectId === project.id).at(-1);
    if (latest) select(latest.id);
    else newSession(project);
  }

  async function addPath(path: string) {
    const project = await api.addProject(path);
    openProject(project);
  }

  function closePalette() {
    setPalette(null);
    setFocusKey((k) => k + 1);
  }

  // Global shortcuts, captured before the terminal sees the keystroke.
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcuts.current = (e) => {
    const key = e.key.toLowerCase();
    let handled = true;
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'k') {
      palette ? closePalette() : setPalette('root');
    } else if (e.altKey && !e.ctrlKey && key === 'n') {
      const project = selectedProject ?? projects.find((p) => p.id === lastProjectId.current);
      project ? newSession(project) : setPalette('root');
    } else if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
      const target = sessions[Number(e.key) - 1];
      if (target) select(target.id);
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
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      {sidebarOpen && (
        <Sidebar
          projects={projects}
          sessions={sessions}
          selectedId={selected?.id ?? null}
          connected={connected}
          themePref={theme.pref}
          onSelect={(s) => select(s.id)}
          onNewSession={newSession}
          onCloseSession={(s) => api.closeSession(s.id)}
          onRenameSession={(s, name) => api.renameSession(s.id, name)}
          onRemoveProject={(p) => api.removeProject(p.id)}
          onOpenPalette={() => setPalette('root')}
          onAddProject={() => setPalette('root')}
          onSetTheme={theme.setPref}
        />
      )}

      <main className="main">
        {selected ? (
          <section className="pane">
            <header className="pane-bar">
              <button className="icon-btn" title="Toggle sidebar" onClick={toggleSidebar}>
                <PanelLeft size={15} />
              </button>
              <div className="crumbs">
                <span className="crumb-project">{selectedProject?.name}</span>
                <span className="crumb-sep">/</span>
                <span className="crumb-session">{selected.name}</span>
              </div>
              <span className="pane-path" title={selected.cwd}>
                {selected.cwd}
              </span>
              <span className="pane-spacer" />
              <button className="icon-btn" title="Restart session" onClick={() => api.restartSession(selected.id)}>
                <RotateCcw size={14} />
              </button>
              {selected.status === 'running' ? (
                <ConfirmButton
                  className="icon-btn"
                  title="End session"
                  confirmLabel="End session"
                  onConfirm={() => api.closeSession(selected.id)}
                >
                  <X size={15} />
                </ConfirmButton>
              ) : (
                <button className="icon-btn" title="Close" onClick={() => api.closeSession(selected.id)}>
                  <X size={15} />
                </button>
              )}
            </header>

            <TerminalView sessionId={selected.id} theme={terminalThemes[theme.resolved]} focusKey={focusKey} />

            {selected.status === 'exited' && (
              <div className="ended-bar">
                <span>
                  Session ended{selected.exitCode !== null ? ` with code ${selected.exitCode}` : ''}
                </span>
                <span className="pane-spacer" />
                <button className="btn btn-ghost" onClick={() => api.closeSession(selected.id)}>
                  Close
                </button>
                <button className="btn btn-secondary" onClick={() => api.restartSession(selected.id)}>
                  Restart
                </button>
              </div>
            )}
          </section>
        ) : (
          <EmptyState
            ready={!!state}
            projects={projects}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            onOpenPalette={() => setPalette('root')}
            onOpenProject={openProject}
          />
        )}
      </main>

      {palette && (
        <CommandPalette
          initialMode={palette}
          projects={projects}
          currentProject={selectedProject}
          onClose={closePalette}
          onOpenProject={openProject}
          onAddPath={addPath}
          onNewSession={newSession}
          onSetTheme={theme.setPref}
          onToggleSidebar={toggleSidebar}
        />
      )}
    </div>
  );
}

function EmptyState(props: {
  ready: boolean;
  projects: Project[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  onOpenProject: (p: Project) => void;
}) {
  if (!props.ready) return null;
  return (
    <div className="empty">
      {!props.sidebarOpen && (
        <button className="icon-btn empty-toggle" title="Toggle sidebar" onClick={props.onToggleSidebar}>
          <PanelLeft size={15} />
        </button>
      )}
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
