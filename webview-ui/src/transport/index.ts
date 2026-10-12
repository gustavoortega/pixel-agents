import type { ServerMessage } from '../../../core/src/messages.js';
import { isBrowserRuntime } from '../runtime.js';
import { PostMessageTransport } from './postMessageTransport.js';
import { installReconnectResync } from './reconnect.js';
import type { MessageTransport } from './types.js';
import { WebSocketTransport } from './webSocketTransport.js';

function createTransport(): MessageTransport {
  if (!isBrowserRuntime) {
    return new PostMessageTransport();
  }
  // Standalone browser: connect via WebSocket to the same host serving the SPA.
  // The server token rides the handshake query when this page was opened from
  // the tokened URL the CLI printed: /ws refuses any other token, a missing one
  // included, with WS_CLOSE_UNAUTHORIZED (server/src/httpServer.ts), and the
  // transport stops there (`rejected`). WebSocketTransport captures the url once,
  // so the token survives reconnects even if the address bar is later cleared.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = new URLSearchParams(window.location.search).get('token');
  const wsUrl = `${protocol}//${window.location.host}/ws${
    token ? `?token=${encodeURIComponent(token)}` : ''
  }`;
  const ws = new WebSocketTransport(wsUrl);
  ws.connect();
  // Vite dev only: there is no server to connect to, so `browserMock` injects
  // ServerMessages as `window` 'message' events. Bridge them into the transport
  // (the WebSocket never opens against the dev server). Guarded by DEV so it's
  // tree-shaken out of the production standalone build.
  if (import.meta.env.DEV) {
    window.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as unknown;
      if (
        data &&
        typeof data === 'object' &&
        typeof (data as { type?: unknown }).type === 'string'
      ) {
        ws.deliver(data as ServerMessage);
      }
    });
  }
  return ws;
}

/** Singleton transport instance. Import this everywhere instead of vscodeApi. */
export const transport: MessageTransport = createTransport();
// At module scope, before any component mounts: no reconnect can slip past it.
installReconnectResync(transport);
export type { MessageTransport } from './types.js';
