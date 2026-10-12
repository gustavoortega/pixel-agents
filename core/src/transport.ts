import {
  TRANSPORT_STATE_CONNECTED,
  TRANSPORT_STATE_CONNECTING,
  TRANSPORT_STATE_DISCONNECTED,
  TRANSPORT_STATE_RECONNECTING,
  TRANSPORT_STATE_REJECTED,
} from './constants.js';
import type { ClientMessage, ServerMessage } from './messages.js';

/** Connection lifecycle states reported by a MessageTransport. */
export type TransportState =
  | typeof TRANSPORT_STATE_CONNECTING
  | typeof TRANSPORT_STATE_CONNECTED
  | typeof TRANSPORT_STATE_RECONNECTING
  | typeof TRANSPORT_STATE_DISCONNECTED
  | typeof TRANSPORT_STATE_REJECTED;

/**
 * Transport-agnostic message layer between webview and extension/server.
 *
 * Implementations:
 * - PostMessageTransport: VS Code webview (acquireVsCodeApi); permanently `connected`.
 * - WebSocketTransport: standalone browser; reports connecting/reconnecting/disconnected
 *   as the socket comes and goes, and `rejected` for good once the server refuses its token.
 */
export interface MessageTransport {
  /** Send a message to the extension/server. */
  send(message: ClientMessage): void;
  /** Subscribe to messages from the extension/server. Returns unsubscribe function. */
  onMessage(handler: (message: ServerMessage) => void): () => void;
  /** Resolves once the transport has connected for the first time. */
  readonly ready: Promise<void>;
  /** Current connection state (valid from construction). */
  readonly state: TransportState;
  /** Subscribe to connection-state changes. Returns unsubscribe function. */
  onStateChange(handler: (state: TransportState) => void): () => void;
  /**
   * Subscribe to reconnects: every open after the first one of this page session, fired
   * once the messages queued while down have been sent. Absent on a transport that never
   * reconnects (postMessage), so nothing there re-runs the handshake.
   */
  onReconnect?(handler: () => void): () => void;
  /** Clean up resources (WebSocket close, etc.). */
  dispose(): void;
}
