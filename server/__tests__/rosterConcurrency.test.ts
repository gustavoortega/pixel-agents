import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, expect, it } from 'vitest';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-roster-conc-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const TSX = path.resolve(__dirname, '../../node_modules/.bin/tsx');
const WORKER = path.resolve(__dirname, 'helpers/rosterWorker.ts');

function runWorker(file: string, go: string, rounds: number, agentId: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [WORKER, file, go, String(rounds), String(agentId)], {
      stdio: 'inherit',
      // The worker only touches the file it is given; keep HOME out of reach anyway.
      env: { ...process.env, HOME: dir, USERPROFILE: dir },
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

it('two processes adding XP on one file lose no increments (R7)', async () => {
  const file = path.join(dir, 'roster.json');
  const go = path.join(dir, 'go');
  const rounds = 50;
  const exits = Promise.all([runWorker(file, go, rounds, 1), runWorker(file, go, rounds, 2)]);

  // Release both only once each has claimed, so their writes overlap.
  const deadline = Date.now() + 8000;
  while (
    !(fs.existsSync(`${go}.ready.1`) && fs.existsSync(`${go}.ready.2`)) &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 10));
  }
  fs.writeFileSync(go, '');

  expect(await exits).toEqual([0, 0]);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8')) as { members: Array<{ xp: number }> };
  expect(onDisk.members).toHaveLength(2);
  expect(onDisk.members.reduce((sum, m) => sum + m.xp, 0)).toBe(2 * rounds);
}, 30_000);
