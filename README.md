# AgentHub

One dashboard for all your Claude Code sessions, organized by project.

## Run

```sh
npm install
npm start        # builds the UI, serves everything on http://127.0.0.1:4317
npm run dev      # development: UI with hot reload on http://localhost:5173
```

Reloading the page reattaches to running sessions. Projects are saved in
`~/.agenthub/config.json` and sessions in `~/.agenthub/sessions.json`.

When the server stops (restart, closed terminal, reboot, crash), sessions come
back **paused** and resume their Claude conversation (`claude --resume`) as soon
as they are shown. A turn that was running at that moment is interrupted. The
restart button keeps the conversation; "New conversation" starts a fresh one.

## Shortcuts

| Keys          | Action                                 |
| ------------- | -------------------------------------- |
| `Ctrl K`      | Search projects, folders and actions   |
| `Alt N`       | New session in the current project     |
| `Alt G`       | Switch between focus and grid view     |
| `Alt 1` … `9` | Jump to a session (sidebar order)      |
| `Shift Enter` | New line in Claude's prompt            |
| `Ctrl C`      | Copy when text is selected, else interrupt |

Double-click a session in the sidebar to rename it. In grid view, clicking a
session in the sidebar adds it to the grid (up to 6); double-click a cell header
to focus it. `Alt 1…9` uses the physical number keys, so it works on AZERTY too.

## Session status

Sessions started from AgentHub report what they are doing through Claude Code
HTTP hooks, injected with `--settings ~/.agenthub/claude-hooks.json`. They are
added next to your own hooks, never replacing them, and only for these sessions.

| Dot          | Meaning                                              |
| ------------ | ---------------------------------------------------- |
| green, pulse | Working                                              |
| amber        | Needs you: permission, question or plan to review    |
| blue         | Done, not looked at yet                              |
| gray         | Idle                                                 |
| hollow       | Paused after a server restart, resumes when shown    |
| dim          | Process ended                                        |

Amber and blue sessions are listed under **Needs you** and counted in the tab
title. The bell in the sidebar turns on desktop notifications, sent only while
the tab is in the background.

## Environment

| Variable          | Default        | Purpose                         |
| ----------------- | -------------- | ------------------------------- |
| `AGENTHUB_PORT`   | `4317`         | Server port                     |
| `AGENTHUB_HOME`   | `~/.agenthub`  | Where projects are saved        |
| `AGENTHUB_CLAUDE` | `claude`       | Command used to start Claude    |
