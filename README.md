# AgentHub

One dashboard for all your Claude Code sessions, organized by project.

## Run

```sh
npm install
npm start        # builds the UI, serves everything on http://127.0.0.1:4317
npm run dev      # development: UI with hot reload on http://localhost:5173
```

Sessions live in the server process: reloading the page reattaches to them,
stopping the server ends them. Projects are saved in `~/.agenthub/config.json`.

## Shortcuts

| Keys          | Action                                 |
| ------------- | -------------------------------------- |
| `Ctrl K`      | Search projects, folders and actions   |
| `Alt N`       | New session in the current project     |
| `Alt 1` … `9` | Jump to a session (sidebar order)      |
| `Shift Enter` | New line in Claude's prompt            |
| `Ctrl C`      | Copy when text is selected, else interrupt |

Double-click a session in the sidebar to rename it.

## Environment

| Variable          | Default        | Purpose                         |
| ----------------- | -------------- | ------------------------------- |
| `AGENTHUB_PORT`   | `4317`         | Server port                     |
| `AGENTHUB_HOME`   | `~/.agenthub`  | Where projects are saved        |
| `AGENTHUB_CLAUDE` | `claude`       | Command used to start Claude    |
