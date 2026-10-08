import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { api } from './api';

const theme: ITheme = {
  background: '#0e0f11',
  foreground: '#d9dbe0',
  cursor: '#d9dbe0',
  cursorAccent: '#0e0f11',
  selectionBackground: '#3a3f4b',
  black: '#1b1d21',
  red: '#e5726f',
  green: '#7cc38b',
  yellow: '#e2b86b',
  blue: '#76a5e8',
  magenta: '#c49be3',
  cyan: '#6cc3c9',
  white: '#c9ccd3',
  brightBlack: '#5c616b',
  brightRed: '#f08b88',
  brightGreen: '#97d6a4',
  brightYellow: '#efcb86',
  brightBlue: '#93b9ef',
  brightMagenta: '#d4b3ec',
  brightCyan: '#89d3d8',
  brightWhite: '#f1f2f4',
};

interface Props {
  sessionId: string;
  onExit?: (code: number | null) => void;
}

export function TerminalView({ sessionId, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    const ws = new WebSocket(api.streamUrl(sessionId));
    const send = (msg: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

    const sendSize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      fit.fit();
      send({ t: 'resize', cols: term.cols, rows: term.rows });
    };

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      // Shift+Enter inserts a newline in Claude's prompt (same bytes as Alt+Enter).
      if (e.key === 'Enter' && e.shiftKey) {
        send({ t: 'in', d: '\x1b\r' });
        return false;
      }
      // Ctrl+C copies when text is selected, otherwise it interrupts as usual.
      if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      // Let the browser fire a paste event, which xterm turns into input.
      if (e.ctrlKey && e.key === 'v') return false;
      return true;
    });

    term.onData((d) => send({ t: 'in', d }));

    ws.onopen = sendSize;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.t === 'out') term.write(msg.d);
      if (msg.t === 'exit') onExitRef.current?.(msg.code);
    };

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sendSize);
    });

    // Wait for the monospace font so the cell grid is measured correctly.
    document.fonts.load('13px "JetBrains Mono Variable"').finally(() => {
      if (disposed) return;
      term.open(host);
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // Falls back to the DOM renderer.
      }
      sendSize();
      observer.observe(host);
      term.focus();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [sessionId]);

  return <div className="terminal-host" ref={hostRef} />;
}
