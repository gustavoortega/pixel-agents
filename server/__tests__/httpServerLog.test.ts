import * as http from 'http';
import { PassThrough } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';
import { createHttpServer } from '../src/httpServer.js';

/** What a browser or a guessing client puts in `?token=`. */
const SECRET = 'abc123';

/** Raw request: fetch() cannot forge the Host header the rebinding check reads. */
function send(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string> },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('standalone request log', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  // The printed URL carries the token and the SPA forwards it on the /ws
  // handshake, so any route can be asked for with it: the SPA path, a path
  // nothing serves (Fastify's own not-found handler logs the raw url), health,
  // a rebound Host, the hook ingress with the token as a wrong Bearer, the
  // limits ingress with it in the Bearer and the query, and an upgrade on a
  // route with no ws handler, which @fastify/websocket logs under its own
  // `path` key.
  it('never holds the token, and still logs each request with its url redacted', async () => {
    const log = new PassThrough();
    let output = '';
    log.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const { app, port } = await createHttpServer({
      embedded: false,
      token: 'the-server-token',
      store: new AgentStateStore(),
      logStream: log,
    });
    close = () => app.close();

    const statuses = [
      await send(port, { path: `/?token=${SECRET}` }),
      await send(port, { path: `/nope?token=${SECRET}` }),
      await send(port, { path: `/api/health?token=${SECRET}` }),
      await send(port, { path: `/?token=${SECRET}`, headers: { Host: 'evil.example' } }),
      await send(port, {
        method: 'POST',
        path: '/api/hooks/claude',
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      }),
      await send(port, {
        method: 'POST',
        path: `/api/statusline/claude-statusline?token=${SECRET}`,
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      }),
    ];
    expect(statuses).toEqual([404, 404, 200, 403, 401, 401]);
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port.toString()}/api/health?token=${SECRET}`);
      socket.on('close', () => resolve());
      socket.on('error', () => {
        /* the server closes the upgrade; the paired error is expected */
      });
    });

    // Each line lands after its response does: wait for the last one of every
    // request, so a leak written late cannot slip past the check below.
    const lines = (): string[] => output.split('\n').filter((line) => line.startsWith('{'));
    await vi.waitFor(() => {
      expect(lines().filter((line) => line.includes('"msg":"request completed"'))).toHaveLength(
        statuses.length,
      );
      expect(output).toContain('with no websocket handler');
    });

    for (const line of lines()) expect(line).not.toContain(SECRET);
    const requests = lines().map(
      (line) => JSON.parse(line) as { msg?: string; req?: { url?: string } },
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        msg: 'incoming request',
        req: expect.objectContaining({ url: '/?token=[redacted]' }),
      }),
    );
  });
});
