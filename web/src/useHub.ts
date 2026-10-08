import { useEffect, useState } from 'react';
import { api, type Project, type SessionInfo } from './api';

export interface HubState {
  projects: Project[];
  sessions: SessionInfo[];
}

/** Live projects + sessions pushed by the server; reconnects if the server restarts. */
export function useHub() {
  const [state, setState] = useState<HubState | null>(null);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(api.eventsUrl());
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'state') setState({ projects: msg.projects, sessions: msg.sessions });
      };
      ws.onclose = () => {
        if (closed) return;
        setConnected(false);
        retry = setTimeout(connect, 1500);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      ws.close();
    };
  }, []);

  return { state, connected };
}
