/**
 * Idle life: which pose an agent takes for a status and time idle, and that a flapping status
 * neither flaps the pose nor sends anyone to the sofa. The pose table is pure; the trips run on a
 * real OfficeState with the bundled furniture.
 *
 * Run with: npm test
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { applyAgentStatus } from '../src/office/engine/agentStatus.js';
import { idlePose, isCoffeeDrinker } from '../src/office/engine/idleLife.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { CharacterState, IdlePose, TileType, WorkStatus } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

const drinkers = Array.from({ length: 60 }, (_, i) => i + 1).filter(isCoffeeDrinker);
const homebodies = Array.from({ length: 60 }, (_, i) => i + 1).filter((i) => !isCoffeeDrinker(i));
const DRINKER = drinkers[0];
const HOMEBODY = homebodies[0];

const base = {
  status: WorkStatus.IDLE,
  idleSec: 0,
  hasSeat: true,
  seed: HOMEBODY,
  sofaFree: true,
  coffeeReady: true,
  current: IdlePose.READING,
};

describe('idlePose table (K5)', () => {
  it.each([
    ['active types', { status: WorkStatus.ACTIVE }, IdlePose.TYPING],
    ['waiting shows the bubble pose', { status: WorkStatus.WAITING }, IdlePose.WAIT_BUBBLE],
    ['idle 5 min reads', { idleSec: 300 }, IdlePose.READING],
    ['idle 15 min naps', { idleSec: 900 }, IdlePose.NAPPING],
    [
      'a napper stays napping within the idle span',
      { idleSec: 100, current: IdlePose.NAPPING },
      IdlePose.NAPPING,
    ],
    ['no desk, no pose', { hasSeat: false, idleSec: 900 }, IdlePose.TYPING],
    [
      'a drinker with a free sofa goes for coffee',
      { seed: DRINKER, idleSec: 300 },
      IdlePose.COFFEE,
    ],
    [
      'a drinker with the sofas full keeps reading',
      { seed: DRINKER, idleSec: 300, sofaFree: false },
      IdlePose.READING,
    ],
    ['a drinker idle under 2 min keeps reading', { seed: DRINKER, idleSec: 60 }, IdlePose.READING],
    [
      'a drinker on cooldown keeps reading',
      { seed: DRINKER, idleSec: 300, coffeeReady: false },
      IdlePose.READING,
    ],
    [
      'a drinker with the sofas full and 15 min idle naps',
      { seed: DRINKER, idleSec: 900, sofaFree: false },
      IdlePose.NAPPING,
    ],
  ])('%s', (_name, patch, expected) => {
    expect(idlePose({ ...base, ...patch })).toBe(expected);
  });

  it('about one agent in three is a drinker', () => {
    expect(drinkers.length).toBeGreaterThan(12);
    expect(drinkers.length).toBeLessThan(30);
  });
});

// ── On a real office ───────────────────────────────────────────

beforeAll(loadRealAssets);

const COLS = 20;
const ROWS = 10;

/** Four desks in a row, each with a chair on its background row, and two sofas below. */
function lounge(): { os: OfficeState; chairs: string[] } {
  const furniture: PlacedFurniture[] = [];
  const chairs: string[] = [];
  for (let i = 0; i < 4; i++) {
    furniture.push({ uid: `desk${i}`, type: 'DESK_FRONT', col: 1 + i * 4, row: 2 });
    furniture.push({ uid: `chair${i}`, type: 'CUSHIONED_CHAIR_FRONT', col: 2 + i * 4, row: 2 });
    chairs.push(`chair${i}`);
  }
  furniture.push({ uid: 'sofaA', type: 'SOFA_FRONT', col: 2, row: 7 });
  furniture.push({ uid: 'sofaB', type: 'SOFA_FRONT', col: 6, row: 7 });
  const os = new OfficeState({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
  } as OfficeLayout);
  return { os, chairs };
}

function run(os: OfficeState, seconds: number, onTick?: (t: number) => void): void {
  const dt = 0.1;
  for (let t = 0; t < seconds; t += dt) {
    os.update(dt);
    onTick?.(t);
  }
}

function addIdle(os: OfficeState, id: number, seat: string): void {
  os.addAgent(id, 0, 0, seat, true, undefined, undefined, false);
}

describe('pose churn (K9)', () => {
  it('a status flipping active/waiting every 2 s for 60 s changes the pose at most twice and sends nobody for coffee', () => {
    const { os, chairs } = lounge();
    addIdle(os, DRINKER, chairs[0]);
    const ch = os.characters.get(DRINKER)!;
    let changes = 0;
    let last = ch.pose;
    let coffee = 0;
    run(os, 60, (t) => {
      if (Math.abs(t % 2) < 0.05) {
        applyAgentStatus(
          os,
          DRINKER,
          Math.round(t / 2) % 2 === 0 ? 'active' : 'waiting',
          false,
          true,
        );
      }
      if (ch.pose !== last) changes++;
      last = ch.pose;
      if (ch.trip || ch.pose === IdlePose.COFFEE) coffee++;
    });
    expect(changes).toBeLessThanOrEqual(2);
    expect(coffee).toBe(0);
  });

  it('short idle windows between work never add up to a coffee trip', () => {
    const { os, chairs } = lounge();
    addIdle(os, DRINKER, chairs[0]);
    const ch = os.characters.get(DRINKER)!;
    let coffee = 0;
    run(os, 120, (t) => {
      // 6 s idle (long enough for the pose to settle), 6 s working
      if (Math.abs(t % 12) < 0.05) applyAgentStatus(os, DRINKER, 'idle', false, true);
      if (Math.abs((t + 6) % 12) < 0.05) applyAgentStatus(os, DRINKER, 'active', false, false);
      if (ch.trip || ch.pose === IdlePose.COFFEE) coffee++;
    });
    expect(coffee).toBe(0);
  });

  it('control: the same drinker left idle for 2 minutes does head for the sofa', () => {
    const { os, chairs } = lounge();
    addIdle(os, DRINKER, chairs[0]);
    // idle time is re-checked on the 60 s tick, so the trip starts between 2 and 3 minutes in
    run(os, 190);
    expect(os.characters.get(DRINKER)!.trip).not.toBeNull();
  });
});

describe('coffee trips', () => {
  it('never put more than two agents on the sofas', () => {
    const { os, chairs } = lounge();
    drinkers.slice(0, 4).forEach((id, i) => addIdle(os, id, chairs[i]));
    run(os, 230);
    const trips = [...os.characters.values()].filter((c) => c.trip).length;
    expect(trips).toBe(2);
    // the other two keep reading at their desks
    const readers = [...os.characters.values()].filter((c) => !c.trip);
    for (const c of readers) {
      expect(c.pose).toBe(IdlePose.READING);
      expect(c.state).toBe(CharacterState.TYPE);
    }
  });

  it('sit on a sofa cushion, stay at least a minute after work resumes, then walk back to the desk', () => {
    const { os, chairs } = lounge();
    addIdle(os, DRINKER, chairs[0]);
    const ch = os.characters.get(DRINKER)!;
    // out, and onto a cushion
    for (let t = 0; t < 400 && ch.trip?.stage !== 'sat'; t += 0.1) os.update(0.1);
    expect(ch.trip?.stage).toBe('sat');
    const sofaSeat = os.seats.get(ch.trip!.sofaSeatId)!;
    expect([ch.tileCol, ch.tileRow]).toEqual([sofaSeat.seatCol, sofaSeat.seatRow]);

    applyAgentStatus(os, DRINKER, 'active', false, false);
    run(os, 30);
    expect(ch.trip?.stage, 'still on the sofa before the minimum stay').toBe('sat');
    run(os, 40);
    expect(ch.trip).toBeNull();
    run(os, 30);
    const desk = os.seats.get(chairs[0])!;
    expect([ch.tileCol, ch.tileRow]).toEqual([desk.seatCol, desk.seatRow]);
    expect(ch.pose).toBe(IdlePose.TYPING);
  });

  it('turn around where they stand when work resumes mid-walk, without a jump', () => {
    const { os, chairs } = lounge();
    addIdle(os, DRINKER, chairs[0]);
    const ch = os.characters.get(DRINKER)!;
    run(os, 182); // the trip starts on the 3-minute tick and the walk takes several seconds
    expect(ch.trip?.stage).toBe('out');
    const before = { x: ch.x, y: ch.y };
    applyAgentStatus(os, DRINKER, 'active', false, false);
    os.update(0.1);
    expect(ch.trip).toBeNull();
    expect(Math.hypot(ch.x - before.x, ch.y - before.y)).toBeLessThan(8);
    expect(ch.pose).toBe(IdlePose.TYPING);
  });
});
