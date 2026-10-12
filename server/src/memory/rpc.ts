import {
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './constants.js';
import { callTool, isToolName, TOOL_DEFINITIONS, type ToolContext } from './tools.js';

/**
 * JSON-RPC 2.0 for MCP over newline-delimited stdio: one input line in, at most one output line back. A
 * message without an id member is a notification and is never answered; call order is not enforced
 * (tools/list before initialize is served).
 */

type Id = string | number | null;

function reply(id: Id, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function error(id: Id, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function initializeResult(params: unknown, version: string): unknown {
  const requested = isPlainObject(params) ? params['protocolVersion'] : undefined;
  return {
    protocolVersion:
      typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0],
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version },
    instructions: SERVER_INSTRUCTIONS,
  };
}

/** Returns the response line (without its newline), or null for a notification. */
export function createDispatcher(
  ctx: ToolContext,
  version: string,
): (line: string) => Promise<string | null> {
  return async (line: string): Promise<string | null> => {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return error(null, RPC_PARSE_ERROR, 'Parse error');
    }
    if (!isPlainObject(msg)) return error(null, RPC_INVALID_REQUEST, 'Invalid Request');
    const rawId = msg['id'];
    const validId = typeof rawId === 'string' || typeof rawId === 'number';
    if (msg['jsonrpc'] !== '2.0' || typeof msg['method'] !== 'string') {
      return error(validId ? rawId : null, RPC_INVALID_REQUEST, 'Invalid Request');
    }
    if (!Object.prototype.hasOwnProperty.call(msg, 'id')) return null;
    if (!validId) return error(null, RPC_INVALID_REQUEST, 'Invalid Request');
    const id = rawId;
    const method = msg['method'];
    switch (method) {
      case 'initialize':
        return reply(id, initializeResult(msg['params'], version));
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOL_DEFINITIONS });
      case 'tools/call': {
        const params = isPlainObject(msg['params']) ? msg['params'] : {};
        const name = params['name'];
        if (typeof name !== 'string' || !isToolName(name)) {
          return error(id, RPC_INVALID_PARAMS, `Unknown tool: ${String(name)}`);
        }
        return reply(id, await callTool(name, params['arguments'] ?? {}, ctx));
      }
      default:
        return error(id, RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };
}
