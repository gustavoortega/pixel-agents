import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { NAME_POOL, RosterStore } from '../src/roster.js';
import { claimRosterMember } from '../src/rosterAgent.js';
import type { AgentState, PersistedAgent } from '../src/types.js';

let dir: string;
let file: string;
const stores: RosterStore[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-roster-'));
  file = path.join(dir, 'roster.json');
  nextAgent = 1;
});

afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A "process": its own pid, a shared liveness table, a clock that only moves forward. */
function proc(
  pid: number,
  alive: Set<number>,
  extra: Partial<ConstructorParameters<typeof RosterStore>[0]> = {},
) {
  let t = pid * 1_000_000;
  const store = new RosterStore({
    filePath: file,
    pid,
    isAlive: (p) => alive.has(p),
    now: () => ++t,
    paletteCount: () => 6,
    lockRetries: 2,
    lockRetryMs: 1,
    ...extra,
  });
  stores.push(store);
  return store;
}

let nextAgent = 1;
const claim = (s: RosterStore, sessionId: string, folderName?: string, rosterId?: string) =>
  s.claim({ agentId: nextAgent++, sessionId, folderName, rosterId });

describe('RosterStore claim (R1)', () => {
  it('never gives one member to two live agents, and hires only when all are held', () => {
    const s = proc(100, new Set([100]));
    const a = claim(s, 's1');
    const b = claim(s, 's2');
    expect(a?.id).not.toBe(b?.id);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(onDisk.members).toHaveLength(2);

    s.release(1);
    const c = claim(s, 's3');
    expect(c?.id).toBe(a?.id);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).members).toHaveLength(2);
  });

  it('names hires from the pool, then falls back to "Agent <n>"', () => {
    const s = proc(100, new Set([100]));
    const names: string[] = [];
    for (let i = 0; i < NAME_POOL.length + 1; i++) names.push(claim(s, `s${i}`)?.name ?? '');
    expect(names.slice(0, 3)).toEqual(NAME_POOL.slice(0, 3));
    expect(names[NAME_POOL.length]).toBe(`Agent ${NAME_POOL.length + 1}`);
  });

  it('prefers the member last seen in the same folder', () => {
    const s = proc(100, new Set([100]));
    const x = claim(s, 'sx', 'x');
    const y = claim(s, 'sy', 'y');
    // y leaves first, so by recency alone y would be next.
    s.release(2);
    s.release(1);
    expect(claim(s, 'new', 'x')?.id).toBe(x?.id);
    expect(y?.id).not.toBe(x?.id);
  });

  it('among equals takes the member released longest ago, not the one with the most XP', () => {
    const s = proc(100, new Set([100]));
    const m1 = claim(s, 's1', 'x');
    const m2 = claim(s, 's2', 'x');
    const m3 = claim(s, 's3', 'x');
    s.award(m3!.id, { xp: 5000 });
    s.release(2);
    s.release(3);
    s.release(1);
    expect(claim(s, 'new', 'x')?.id).toBe(m2?.id);
    expect(m1?.id).not.toBe(m2?.id);
  });
});

describe('RosterStore across processes (R1b)', () => {
  it('two processes on one file claim different members', () => {
    const alive = new Set([101, 102]);
    const a = proc(101, alive);
    const b = proc(102, alive);
    const ma = a.claim({ agentId: 1, sessionId: 'sa' });
    const mb = b.claim({ agentId: 1, sessionId: 'sb' });
    expect(ma?.id).not.toBe(mb?.id);
  });

  it('a hold whose pid is dead can be reclaimed', () => {
    const a = proc(101, new Set([101]));
    const ma = a.claim({ agentId: 1, sessionId: 'sa' });
    const b = proc(102, new Set([102]));
    const mb = b.claim({ agentId: 1, sessionId: 'sb' });
    expect(mb?.id).toBe(ma?.id);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).holds).toHaveLength(1);
  });
});

describe('RosterStore session identity (R1c)', () => {
  it('an agent with a new id but a known session gets its old member', () => {
    const s = proc(100, new Set([100]));
    claim(s, 'older');
    const mine = claim(s, 'mine');
    s.release(1);
    s.release(2);
    // 'older' left first, so recency alone would pick it.
    const back = s.claim({ agentId: 77, sessionId: 'mine' });
    expect(back?.id).toBe(mine?.id);
  });

  it('after /clear the member follows the new session through a restart', () => {
    const s = proc(100, new Set([100]));
    claim(s, 'other');
    const mine = claim(s, 'before-clear');
    s.rebindSession(2, 'after-clear');
    s.release(1);
    s.release(2);
    expect(s.claim({ agentId: 9, sessionId: 'after-clear' })?.id).toBe(mine?.id);
  });

  it('a live hold in another process is not taken by the same session', () => {
    const alive = new Set([101, 102]);
    const a = proc(101, alive);
    const b = proc(102, alive);
    const ma = a.claim({ agentId: 1, sessionId: 'shared' });
    const mb = b.claim({ agentId: 1, sessionId: 'shared' });
    expect(mb?.id).not.toBe(ma?.id);
  });
});

describe('RosterStore lockfile (R1e)', () => {
  const lock = () => file + '.lock';
  const age = (seconds: number) => {
    const old = new Date(Date.now() - seconds * 1000);
    fs.utimesSync(lock(), old, old);
  };

  it('keeps a lock whose owner is alive, however old', () => {
    fs.writeFileSync(lock(), '4242');
    age(60);
    const s = proc(100, new Set([100, 4242]), { now: Date.now });
    expect(s.claim({ agentId: 1, sessionId: 's' })).toBeUndefined();
    expect(fs.existsSync(lock())).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('breaks a lock whose owner is dead, even a fresh one', () => {
    fs.writeFileSync(lock(), '4242');
    const s = proc(100, new Set([100]), { now: Date.now });
    expect(s.claim({ agentId: 1, sessionId: 's' })).toBeDefined();
    expect(fs.existsSync(lock())).toBe(false);
  });

  it('breaks an unreadable lock only once it is older than the stale age', () => {
    fs.writeFileSync(lock(), '');
    const s = proc(100, new Set([100]), { now: Date.now });
    expect(s.claim({ agentId: 1, sessionId: 's' })).toBeUndefined();
    age(30);
    expect(s.claim({ agentId: 1, sessionId: 's' })).toBeDefined();
  });
});

function agentState(overrides: Partial<AgentState>): AgentState {
  return {
    id: 1,
    sessionId: 's',
    isExternal: true,
    projectDir: '/test',
    jsonlFile: '/test/s.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: 200_000,
    ...overrides,
  } as AgentState;
}

describe('RosterStore release on store delete (R1d)', () => {
  it('frees the member whenever the agent leaves the store, teammates included', () => {
    const store = new AgentStateStore();
    const roster = proc(100, new Set([100]));
    roster.attach(store);
    const runtime = new AgentRuntime(store, claudeProvider);

    const lead = agentState({ id: 1, sessionId: 'lead' });
    const mate = agentState({ id: 2, sessionId: 'mate', leadAgentId: 1, agentName: 'mate' });
    const stale = agentState({ id: 3, sessionId: 'stale' });
    for (const a of [lead, mate, stale]) {
      claimRosterMember(a, store);
      store.set(a.id, a);
    }
    const holds = () => JSON.parse(fs.readFileSync(file, 'utf-8')).holds.length;
    expect(holds()).toBe(3);

    runtime.removeTeammate(2, 'test');
    expect(holds()).toBe(2);
    // Stale cleanup and every other removal path end in store.delete.
    store.delete(3);
    expect(holds()).toBe(1);
    runtime.dispose();
    store.dispose();
  });
});

describe('restore reclaims the persisted member (R2)', () => {
  it('an agent restored with a rosterId gets that member, not the least recently released', () => {
    const jsonl = path.join(dir, 'session.jsonl');
    fs.writeFileSync(jsonl, '');
    const roster = proc(100, new Set([100]));
    const first = roster.claim({ agentId: 1, sessionId: 'first' });
    const second = roster.claim({ agentId: 2, sessionId: 'second' });
    // `first` leaves earlier, so the fallback would hand it out.
    roster.release(1);
    roster.release(2);

    const persisted: PersistedAgent[] = [
      {
        id: 7,
        sessionId: 'unknown-session',
        terminalName: '',
        isExternal: true,
        jsonlFile: jsonl,
        projectDir: dir,
        rosterId: second?.id,
      },
    ];
    const adapter: StateAdapter = {
      loadAgents: () => persisted,
      saveAgents: () => {},
      loadSeats: () => ({}),
      saveSeats: () => {},
      getSetting: <T>(_k: string, d: T): T => d,
      setSetting: () => {},
    };
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    roster.attach(store);
    const runtime = new AgentRuntime(store, claudeProvider);

    runtime.restoreExternalAgents();

    expect(store.get(7)?.rosterId).toBe(second?.id);
    expect(store.get(7)?.palette).toBe(second?.palette);
    expect(first?.id).not.toBe(second?.id);
    runtime.dispose();
    store.dispose();
  });
});
