/**
 * Helpers (sub-agents): they look like the parent's gray cousin, take a free desk seat in the
 * parent's room (or stand clear of the parent), and a saved seat outside the folder's mapped
 * rooms is not honoured.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { HUE_LOCKED } from '../../core/src/assets/skinTones.js';
import { characterAnimation } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { seatedBubbleOffsetPx, seatedDrawOffsetPx } from '../src/office/seatDraw.js';
import { getCharacterSprites } from '../src/office/sprites/spriteData.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { Direction, TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

beforeAll(loadRealAssets);

const COLS = 12;
const ROWS = 8;

/** Two rooms side by side: A is columns 0-5, B is columns 6-11. */
function office(furniture: PlacedFurniture[]): OfficeState {
  const areaTiles = Array.from({ length: COLS * ROWS }, (_, i) => (i % COLS < 6 ? 'A' : 'B'));
  return new OfficeState({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
    areaTiles,
  } as OfficeLayout);
}

const chair = (uid: string, col: number, row: number): PlacedFurniture => ({
  uid,
  type: 'CUSHIONED_CHAIR_FRONT',
  col,
  row,
});

function saturation(px: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(px.slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

describe('helper look', () => {
  it('keeps the parent face and washes hair and outfit to gray, without touching the parent sheet', () => {
    for (let n = 0; n < 12; n++) {
      const parentBefore = getCharacterSprites(n, 0).walk[Direction.DOWN][1];
      const helper = getCharacterSprites(n, 0, true).walk[Direction.DOWN][1];
      let satParent = 0;
      let satHelper = 0;
      let skin = 0;
      parentBefore.forEach((row, y) =>
        row.forEach((px, x) => {
          if (px === '') return;
          if (HUE_LOCKED.has(px)) {
            skin++;
            expect(helper[y][x], `char_${n} skin at ${x},${y}`).toBe(px);
          } else {
            satParent += saturation(px);
            satHelper += saturation(helper[y][x]);
          }
        }),
      );
      expect(skin, `char_${n} has skin`).toBeGreaterThan(0);
      expect(satHelper, `char_${n} is grayer than its parent`).toBeLessThan(satParent * 0.6);
      expect(getCharacterSprites(n, 0).walk[Direction.DOWN][1]).toBe(parentBefore);
    }
  });
});

describe('helper placement', () => {
  it('takes the nearest free seat in the parent room, not a nearer one in another room', () => {
    // Parent at (5,3) in room A. Room B's seat (6,3) is one tile away, room A's free seat is four.
    const os = office([chair('parent', 5, 3), chair('a-free', 1, 3), chair('b-near', 6, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    const subId = os.addSubagent(1, 'tool-1');
    const sub = os.characters.get(subId)!;
    expect(sub.seatId).toBe('a-free');
    expect([sub.tileCol, sub.tileRow]).toEqual([1, 3]);
    expect(os.seats.get('a-free')!.assigned).toBe(true);
  });

  it('with no free seat, stands two or more tiles from the parent and off its column', () => {
    const os = office([chair('parent', 5, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
    expect(sub.seatId).toBeNull();
    const dist = Math.max(Math.abs(sub.tileCol - 5), Math.abs(sub.tileRow - 3));
    expect(dist).toBeGreaterThanOrEqual(2);
    expect(sub.tileCol).not.toBe(5);
  });
});

describe('a helper with no seat', () => {
  it('stands at work: no sit offset, the standing frame, however long it runs', () => {
    const os = office([chair('parent', 5, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
    os.setAgentActive(sub.id, true);
    for (let i = 0; i < 40; i++) os.update(0.1);
    expect(sub.seatId).toBeNull();
    expect(sub.isActive).toBe(true);
    expect(seatedDrawOffsetPx(sub)).toBe(0);
    expect(seatedBubbleOffsetPx(sub)).toBe(0);
    expect(characterAnimation(sub)).toEqual({ set: 'walk', index: 1 });
  });
});

describe('a saved seat outside the folder mapped rooms', () => {
  const furniture = [chair('a-seat', 1, 3), chair('b-seat', 8, 3)];

  it('is not honoured: the agent gets a seat in its mapped room', () => {
    const os = office(furniture);
    os.setAreaMappings({ research: ['A'] });
    os.addAgent(1, 0, 0, 'b-seat', true, 'research');
    expect(os.seatZone(os.characters.get(1)!.seatId!)).toBe('A');
  });

  it('stands when the folder has no mapping (manual placement)', () => {
    const os = office(furniture);
    os.addAgent(1, 0, 0, 'b-seat', true, 'unmapped');
    expect(os.characters.get(1)!.seatId).toBe('b-seat');
  });
});

describe('a top-level agent outranks a helper for a seat', () => {
  const back = (uid: string, col: number, row: number): PlacedFurniture => ({
    uid,
    type: 'CUSHIONED_CHAIR_BACK',
    col,
    row,
  });

  it('reload order: a helper recreated before its parent is restored leaves the parent saved seat free', () => {
    // The helper's lazy creation (subagentToolStart, subagentPresent) can land while the parent is
    // still buffered: the parent still gets its saved seat, then the helper sits beside it.
    const os = office([chair('face-on', 3, 3), back('back-view', 4, 3)]);
    const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
    os.addAgent(1, 0, 0, 'back-view', true);
    expect(os.characters.get(1)!.seatId).toBe('back-view');
    expect(sub.seatId).toBe('face-on');
  });

  it('takes its saved seat back from a helper that sits in it; the helper moves to the other seat', () => {
    const os = office([chair('p', 5, 3), chair('face-on', 3, 3), back('back-view', 4, 3)]);
    os.addAgent(1, 0, 0, 'p', true);
    const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
    expect(sub.seatId).toBe('back-view'); // nearest to the parent
    os.addAgent(2, 0, 0, 'back-view', true);
    expect(os.characters.get(2)!.seatId).toBe('back-view');
    expect(sub.seatId).toBe('face-on');
    expect([sub.tileCol, sub.tileRow]).toEqual([3, 3]);
  });

  it('with no saved seat, takes the face-on seat a helper holds; the helper stands when none is left', () => {
    const os = office([chair('p', 5, 3), chair('face-on', 4, 3), back('back-view', 3, 3)]);
    os.addAgent(1, 0, 0, 'p', true);
    const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
    expect(sub.seatId).toBe('face-on');
    os.addAgent(2, 0, 0, undefined, true);
    expect(os.characters.get(2)!.seatId).toBe('face-on');
    expect(sub.seatId).toBe('back-view');
    // A third agent takes the last seat: the helper has nowhere left to sit and stands.
    os.addAgent(3, 0, 0, undefined, true);
    expect(os.characters.get(3)!.seatId).toBe('back-view');
    expect(sub.seatId).toBeNull();
    expect(os.seats.get('back-view')!.assigned).toBe(true);
  });

  it('a layout change with fewer seats than characters seats the agents and stands the helper', () => {
    const os = office([chair('p', 5, 3), chair('face-on', 3, 3)]);
    os.addAgent(1, 0, 0, 'p', true);
    const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
    os.addAgent(2, 0, 0, 'face-on', true);
    os.rebuildFromLayout({
      ...os.getLayout(),
      furniture: [chair('x', 5, 3), chair('y', 3, 3)],
    });
    expect(os.characters.get(1)!.seatId).not.toBeNull();
    expect(os.characters.get(2)!.seatId).not.toBeNull();
    expect(sub.seatId).toBeNull();
  });
});

/** Room A is columns 0-5; columns 6-11 belong to no Area: the lobby. */
function officeWithLobby(furniture: PlacedFurniture[]): OfficeState {
  const areaTiles = Array.from({ length: COLS * ROWS }, (_, i) => (i % COLS < 6 ? 'A' : null));
  return new OfficeState({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
    areaTiles,
  } as OfficeLayout);
}

const crew = (agent: string): string => `wf:5b1fa126-e5b:${agent}`;

describe('C9 a helper whose parent room is full', () => {
  it('takes the nearest free lobby desk seat before standing, never a couch', () => {
    // The couch is the nearest lobby seat; the desk chair is farther.
    const os = officeWithLobby([
      chair('parent', 5, 3),
      { uid: 'couch', type: 'SOFA_FRONT', col: 7, row: 3 },
      chair('lobby-desk', 10, 6),
    ]);
    os.addAgent(1, 0, 0, 'parent', true);
    const sub = os.characters.get(os.addSubagent(1, crew('a1')))!;
    expect(sub.seatId).toBe('lobby-desk');
    expect([sub.tileCol, sub.tileRow]).toEqual([10, 6]);
  });
});

describe('C18 a top-level agent placed after crew helpers took the lobby seats', () => {
  it('never shares a seat with one: crew helpers keep theirs', () => {
    const os = officeWithLobby([chair('parent', 5, 3), chair('l1', 8, 3), chair('l2', 10, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    const a = os.characters.get(os.addSubagent(1, crew('a1')))!;
    const b = os.characters.get(os.addSubagent(1, crew('a2')))!;
    expect(new Set([a.seatId, b.seatId])).toEqual(new Set(['l1', 'l2']));

    os.addAgent(2, 0, 0, 'l1', true); // its saved seat is a crew helper's
    os.addAgent(3, 0, 0, undefined, true);

    const seated = [...os.characters.values()]
      .filter((ch) => ch.seatId !== null && ch.matrixEffect !== 'despawn')
      .map((ch) => ch.seatId);
    expect(new Set(seated).size).toBe(seated.length);
    expect(new Set([a.seatId, b.seatId])).toEqual(new Set(['l1', 'l2']));
  });
});

describe('C19 a lead with more crew helpers than the visible cap', () => {
  it('draws 12; the rest exist without a sprite and the oldest is drawn when one leaves', () => {
    const os = office([chair('parent', 5, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    const ids = Array.from({ length: 14 }, (_, i) => os.addSubagent(1, crew(`a${i + 1}`)));
    // On stage: a character that is not playing its leaving effect.
    const drawn = (): number[] =>
      ids.filter((id) => {
        const ch = os.characters.get(id);
        return ch !== undefined && ch.matrixEffect !== 'despawn';
      });

    expect(drawn()).toEqual(ids.slice(0, 12));
    // The undrawn ones still exist under their keys (their count on the plate: subagentMessages).
    expect(os.getSubagentId(1, crew('a13'))).toBe(ids[12]);
    // A Task helper neither counts toward the cap nor waits behind it.
    expect(os.characters.has(os.addSubagent(1, 'toolu_task'))).toBe(true);

    os.setAgentActive(ids[12], true); // a start that reached the undrawn helper
    os.removeSubagent(1, crew('a1'));

    expect(drawn()).toEqual([...ids.slice(1, 13)]);
    expect(os.characters.get(ids[12])!.isActive).toBe(true);
    expect(os.characters.has(ids[13])).toBe(false);
  });

  it('never counts a Task helper toward the cap, even one drawn before the crew', () => {
    const os = office([chair('parent', 5, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    os.addSubagent(1, 'toolu_task');

    const ids = Array.from({ length: 12 }, (_, i) => os.addSubagent(1, crew(`a${i + 1}`)));

    expect(ids.filter((id) => os.characters.has(id))).toEqual(ids);
  });
});
