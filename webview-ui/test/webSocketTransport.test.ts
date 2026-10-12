/**
 * The standalone transport over a scripted socket, wired the way transport/index.ts wires
 * it (installReconnectResync). A reopen re-runs the handshake exactly once, after the
 * messages queued while the socket was down; the first open never does (the mount-time
 * webviewReady is that connect's handshake). A drop closes the resync window a reopen opened.
 * A refused token (4001) ends the transport instead of a reconnect loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WS_CLOSE_UNAUTHORIZED } from '../../core/src/constants.js';
import { resync } from '../src/office/engine/resync.js';
import { installReconnectResync, reconnectState } from '../src/transport/reconnect.js';
import { WebSocketTransport } from '../src/transport/webSocketTransport.js';
import { openEmptyResyncWindow } from './resyncWindow.js';

/** The browser socket as the transport uses it; the test opens and closes it. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static sockets: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeWebSocket.sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  drop(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const latest = (): FakeWebSocket => FakeWebSocket.sockets[FakeWebSocket.sockets.length - 1];

/** Types of every message sent, over every socket, in order. */
const sentTypes = (): string[] =>
  FakeWebSocket.sockets.flatMap((s) => s.sent.map((d) => (JSON.parse(d) as { type: string }).type));

const handshakes = (): number => sentTypes().filter((t) => t === 'webviewReady').length;

function connect(): WebSocketTransport {
  const transport = new WebSocketTransport('ws://127.0.0.1/ws?token=t');
  installReconnectResync(transport);
  transport.connect();
  return transport;
}

/** The backoff timer fires and the next socket is created. */
function retry(): void {
  vi.advanceTimersToNextTimer();
}

beforeEach(() => {
  FakeWebSocket.sockets = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reconnectState.resyncPending = false;
  resync.abort();
});

describe('WebSocketTransport reconnect', () => {
  it('re-runs the handshake once per reopen, after what was queued, and never on the first open', () => {
    const transport = connect();
    latest().open();
    expect(handshakes()).toBe(0);
    expect(reconnectState.resyncPending).toBe(false);

    latest().drop(1006);
    expect(transport.state).toBe('reconnecting');
    transport.send({ type: 'saveLayout', layout: {} });
    retry();
    latest().open();

    // The layout saved while down must land before the handshake restates the layout.
    expect(latest().sent.map((d) => (JSON.parse(d) as { type: string }).type)).toEqual([
      'saveLayout',
      'webviewReady',
    ]);
    expect(handshakes()).toBe(1);
    // The existingAgents that answers it is a resync (agentListMessages.ts).
    expect(reconnectState.resyncPending).toBe(true);

    // A second outage in the same page session.
    latest().drop(1006);
    retry();
    latest().open();
    expect(handshakes()).toBe(2);
  });

  it('a drop mid-handshake closes the resync window, which no handshakeDone will', () => {
    connect();
    latest().open();
    latest().drop(1006);
    retry();
    latest().open();
    // The reopen's existingAgents opened the window; this socket drops before handshakeDone.
    openEmptyResyncWindow();
    expect(resync.isActive()).toBe(true);

    latest().drop(1006);
    expect(resync.isActive()).toBe(false);
  });

  it('does not count a socket that never opened: a server down at page load', () => {
    connect();
    latest().drop(1006);
    retry();
    latest().open();

    expect(handshakes()).toBe(0);
  });

  it('stops for good when a restarted server refuses the token', () => {
    const transport = connect();
    latest().open();
    latest().drop(1006);
    retry();
    // The new server upgrades the socket first and refuses it in its handler.
    latest().open();
    latest().drop(WS_CLOSE_UNAUTHORIZED);

    expect(handshakes()).toBe(1);
    expect(transport.state).toBe('rejected');
    expect(vi.getTimerCount()).toBe(0);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = sentTypes().length;
    transport.send({ type: 'focusAgent', id: 1 });
    transport.send({ type: 'focusAgent', id: 2 });
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.sockets).toHaveLength(2);
    expect(sentTypes()).toHaveLength(before);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a first connection refused by the server is rejected with no handshake', () => {
    const transport = connect();
    latest().open();
    latest().drop(WS_CLOSE_UNAUTHORIZED);

    expect(transport.state).toBe('rejected');
    expect(handshakes()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
