/**
 * One real process on a shared roster file, for the concurrency court in
 * rosterConcurrency.test.ts. Claims a member, waits for the go file so both workers overlap,
 * then adds +1 XP `rounds` times, flushing after each.
 *
 * Usage: tsx rosterWorker.ts <rosterFile> <goFile> <rounds> <agentId>
 */
import * as fs from 'fs';

import { RosterStore } from '../../src/roster.js';

const [rosterFile, goFile, roundsArg, agentArg] = process.argv.slice(2);
const rounds = Number(roundsArg);
const agentId = Number(agentArg);

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const roster = new RosterStore({ filePath: rosterFile, paletteCount: () => 6 });

let member = roster.claim({ agentId, sessionId: `worker-${agentId}` });
while (!member) {
  pause(5);
  member = roster.claim({ agentId, sessionId: `worker-${agentId}` });
}

fs.writeFileSync(`${goFile}.ready.${agentId}`, '');
while (!fs.existsSync(goFile)) {
  pause(2);
}

for (let i = 0; i < rounds; i++) {
  roster.award(member.id, { xp: 1 });
  while (!roster.flush()) {
    pause(5);
  }
}
roster.dispose();
