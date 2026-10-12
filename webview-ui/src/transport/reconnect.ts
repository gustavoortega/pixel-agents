import { TRANSPORT_STATE_CONNECTED } from '../../../core/src/constants.js';
import { resync } from '../office/engine/resync.js';
import type { MessageTransport } from './types.js';

/** Set when a reconnect re-sends webviewReady. The existingAgents that answers it reads
 *  and clears it: that handshake is a resync (useExtensionMessages). */
export const reconnectState = { resyncPending: false };

/**
 * Re-run the handshake on every reconnect. The server sent this page nothing while the
 * socket was down, so the office may still hold agents, helpers and tool rows that ended
 * meanwhile and miss ones that started. The mount-time webviewReady stays the only
 * handshake of the first connect. A transport without onReconnect (postMessage) never
 * resyncs.
 */
export function installReconnectResync(t: MessageTransport): void {
  if (!t.onReconnect) return;
  t.onReconnect(() => {
    reconnectState.resyncPending = true;
    t.send({ type: 'webviewReady' });
  });
  // A drop mid-handshake never delivers its handshakeDone: close the window unswept.
  t.onStateChange((state) => {
    if (state !== TRANSPORT_STATE_CONNECTED) resync.abort();
  });
}
