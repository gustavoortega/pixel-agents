import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { createHttpServer, type HttpServerOptions, SECURITY_HEADERS } from '../src/httpServer.js';

const TOKEN = 'the-server-token';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
}

/** Raw GET: fetch() can neither forge the Host header the rebinding check
 *  reads nor send a path that is not a valid URL. */
function get(port: number, urlPath: string, host?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    http
      .get(
        { host: '127.0.0.1', port, path: urlPath, headers: host ? { Host: host } : {} },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
        },
      )
      .on('error', reject);
  });
}

/** Raw POST of a JSON body, authenticated with the server's token. */
function post(port: number, urlPath: string, body: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

/** The reply's values for the SECURITY_HEADERS names. */
function securityHeadersOf(reply: Reply): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(SECURITY_HEADERS).map((name) => [name, reply.headers[name.toLowerCase()]]),
  );
}

describe('security headers', () => {
  let tmpDir: string;
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-headers-'));
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function start(options: Partial<HttpServerOptions>): Promise<number> {
    const { app, port } = await createHttpServer({
      embedded: false,
      token: TOKEN,
      store: new AgentStateStore(),
      ...options,
    });
    close = () => app.close();
    return port;
  }

  /** The standalone SPA as the CLI serves it: an index page and one asset. */
  function spaDir(): string {
    const staticDir = path.join(tmpDir, 'webview');
    fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>spa</title>');
    fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'export {};');
    return staticDir;
  }

  it('ride every standalone reply: SPA, asset, fallback, health, limits and the rebinding 403', async () => {
    const port = await start({ staticDir: spaDir() });
    const limits = { fiveHour: { usedPercentage: 37.5, resetsAt: 1_760_000_000 }, sevenDay: null };

    const replies: Array<[name: string, reply: Reply, status: number]> = [
      ['SPA', await get(port, '/'), 200],
      ['asset', await get(port, '/assets/app.js'), 200],
      ['history fallback', await get(port, '/no-such-route'), 200],
      ['health', await get(port, '/api/health'), 200],
      ['official limits', await post(port, '/api/statusline/claude-statusline', limits), 200],
      ['rebound Host', await get(port, '/', 'evil.example'), 403],
    ];
    for (const [name, reply, status] of replies) {
      expect(reply.status, name).toBe(status);
      expect(securityHeadersOf(reply), name).toEqual(SECURITY_HEADERS);
    }
    expect(replies[0][1].headers['content-type']).toMatch(/^text\/html/);
    expect(replies[2][1].headers['content-type']).toMatch(/^text\/html/);
  });

  // The loopback-only Host check must not take the headers with it, and
  // neither may the mode: a LAN bind serves the same SPA, and embedded answers
  // on the same machine.
  it.each([
    ['a LAN bind', { host: '0.0.0.0' }],
    ['embedded mode', { embedded: true }],
  ])('ride replies on %s too', async (_name, options) => {
    const port = await start(options);
    const reply = await get(port, '/api/health');
    expect(reply.status).toBe(200);
    expect(securityHeadersOf(reply)).toEqual(SECURITY_HEADERS);
  });

  // fastify before 5.12.2 (GHSA-p68q-wchp-6fh7) routed a url it could not
  // decode to the not-found handler with a bare reply, and the SPA fallback's
  // reply.sendFile threw out of the request, taking the server down with it.
  it('keeps serving after urls that do not decode', async () => {
    const port = await start({ staticDir: spaDir() });

    for (const badPath of ['/%E0%A4%A', '/%']) {
      expect((await get(port, badPath)).status, badPath).toBeLessThan(500);
    }
    expect((await get(port, '/api/health')).status).toBe(200);
  });
});
