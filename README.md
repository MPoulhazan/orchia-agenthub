# AgentHub

One dashboard for all your Claude Code sessions, organized by project.

## Run

```sh
npm install
npm start        # builds the UI, serves everything on http://127.0.0.1:4317
npm run dev      # development: UI with hot reload on http://localhost:5173
```

Sessions live in the server process: reloading the page reattaches to them,
stopping the server ends them.

Set `AGENTHUB_CLAUDE` to override the command used to start Claude
(default: `claude`), and `AGENTHUB_PORT` to change the server port.
