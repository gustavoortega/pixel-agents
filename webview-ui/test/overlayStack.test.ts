/**
 * The stack above an agent's head, bottom to top: sprite, plate, tripwire chip, bubble. No two
 * boxes may overlap and none may sit on the head, whatever the mix and wherever the room wall is (a close wall flips the
 * group below the feet).
 */
import { describe, expect, it } from 'vitest';

import type { Rect } from '../src/office/labelLayout.js';
import { withTopWallFace } from '../src/office/labelLayout.js';
import { stackAbove, weatherAnchorY } from '../src/office/overlayStack.js';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const plate = { w: 120, h: 28 };
const chip = { w: 120, h: 18 };
const bubble = { w: 22, h: 26 };
/** Head top at y = 300; the head box is the sprite's top 24 px, 32 px wide. */
const HEAD_TOP = 300;
const head: Rect = { x: 184, y: HEAD_TOP, w: 32, h: 24 };
const FEET = HEAD_TOP + 32;

describe('overlay stack', () => {
  const cases: Array<[string, Parameters<typeof stackAbove>[0]]> = [
    ['plate only', { x: 200, headTop: HEAD_TOP, plate, chip: null, bubble: null }],
    ['plate and bubble', { x: 200, headTop: HEAD_TOP, plate, chip: null, bubble }],
    ['plate and chip', { x: 200, headTop: HEAD_TOP, plate, chip, bubble: null }],
    ['plate, chip and bubble', { x: 200, headTop: HEAD_TOP, plate, chip, bubble }],
    ['pushed up by a neighbour', { x: 200, headTop: HEAD_TOP, plate, chip, bubble, dy: -40 }],
    [
      'wall just above: the group is clamped down as one',
      {
        x: 200,
        headTop: HEAD_TOP,
        plate,
        chip,
        bubble,
        floor: { x: 0, y: 230, w: 400, h: 200 },
        head,
        feetY: FEET,
      },
    ],
  ];

  it.each(cases)('%s: no box overlaps another or the head', (_name, input) => {
    const s = stackAbove(input);
    const boxes = [s.plate, s.chip, s.bubble].filter((r): r is Rect => r !== null);
    for (const [i, a] of boxes.entries()) {
      expect(overlaps(a, head), `box ${i} on the head`).toBe(false);
      for (const b of boxes.slice(i + 1))
        expect(overlaps(a, b), `box ${i} over another`).toBe(false);
    }
  });

  it('orders the boxes bottom to top: plate, then chip, then bubble', () => {
    const s = stackAbove({ x: 200, headTop: HEAD_TOP, plate, chip, bubble });
    expect(s.plate!.y + s.plate!.h).toBeLessThanOrEqual(HEAD_TOP);
    expect(s.chip!.y + s.chip!.h).toBeLessThanOrEqual(s.plate!.y);
    expect(s.bubble!.y + s.bubble!.h).toBeLessThanOrEqual(s.chip!.y);
  });

  it('flips the whole group below the feet, order intact, when the wall would push it onto the head', () => {
    const floor: Rect = { x: 0, y: 230, w: 400, h: 200 };
    const s = stackAbove({
      x: 200,
      headTop: HEAD_TOP,
      plate,
      chip,
      bubble,
      floor,
      head,
      feetY: FEET,
    });
    expect(s.plate!.y).toBeGreaterThanOrEqual(FEET);
    expect(s.chip!.y).toBeGreaterThanOrEqual(s.plate!.y + s.plate!.h);
    expect(s.bubble!.y).toBeGreaterThanOrEqual(s.chip!.y + s.chip!.h);
    expect(s.bubble!.y + s.bubble!.h).toBeLessThanOrEqual(floor.y + floor.h);
  });

  it('keeps above and accepts the clamp when below does not fit either', () => {
    const floor: Rect = { x: 0, y: 230, w: 400, h: 110 };
    const s = stackAbove({
      x: 200,
      headTop: HEAD_TOP,
      plate,
      chip,
      bubble,
      floor,
      head,
      feetY: FEET,
    });
    expect(s.bubble!.y).toBeGreaterThanOrEqual(floor.y);
    expect(s.chip!.y).toBeGreaterThan(s.bubble!.y);
    expect(s.plate!.y).toBeGreaterThan(s.chip!.y);
  });

  describe('first floor row under the top wall', () => {
    // The room's floor starts at y = 230; the group needs ~80 px above a head at y = 300.
    const roomFloor: Rect = { x: 0, y: 230, w: 400, h: 200 };
    const base = { x: 200, headTop: HEAD_TOP, plate, chip, bubble, head, feetY: FEET };

    it('stays above the head, over the room wall face, instead of flipping onto the desk', () => {
      const floor = withTopWallFace(roomFloor);
      const s = stackAbove({ ...base, floor });
      const boxes = [s.plate!, s.chip!, s.bubble!];
      for (const b of boxes) {
        expect(b.y + b.h, 'above the head').toBeLessThanOrEqual(HEAD_TOP);
        expect(b.y, 'inside the extended rect').toBeGreaterThanOrEqual(floor.y);
        expect(overlaps(b, head)).toBe(false);
      }
      expect(s.bubble!.y, 'sits over the wall face').toBeLessThan(roomFloor.y);
    });

    it('never flips below the feet for a seated agent facing down, even when it cannot fit', () => {
      const s = stackAbove({ ...base, floor: roomFloor, noFlip: true });
      expect(s.plate!.y).toBeLessThan(FEET);
    });

    it('does not extend sideways, down, or above the map top', () => {
      expect(withTopWallFace({ x: 5, y: 8, w: 40, h: 30 })).toEqual({ x: 5, y: 0, w: 40, h: 38 });
    });
  });

  it('FX text sits above the plate and chip, below the bubble, and clear of the head', () => {
    const fx = { w: 80, h: 22 };
    const s = stackAbove({ x: 200, headTop: HEAD_TOP, plate, chip, fx, bubble });
    expect(s.plate!.y + s.plate!.h).toBeLessThanOrEqual(HEAD_TOP);
    expect(s.chip!.y + s.chip!.h).toBeLessThanOrEqual(s.plate!.y);
    expect(s.fx!.y + s.fx!.h).toBeLessThanOrEqual(s.chip!.y);
    expect(s.bubble!.y + s.bubble!.h).toBeLessThanOrEqual(s.fx!.y);
    expect(overlaps(s.fx!, head)).toBe(false);
  });

  it('FX text with only a plate still stands over the plate, not over the face', () => {
    const s = stackAbove({
      x: 200,
      headTop: HEAD_TOP,
      plate,
      chip: null,
      fx: { w: 80, h: 22 },
      bubble: null,
    });
    expect(s.fx!.y + s.fx!.h).toBeLessThanOrEqual(s.plate!.y);
  });

  it('a close wall flips plate and FX text below the feet together, still in order', () => {
    const s = stackAbove({
      x: 200,
      headTop: HEAD_TOP,
      plate,
      chip: null,
      fx: { w: 80, h: 22 },
      bubble: null,
      floor: { x: 0, y: 290, w: 400, h: 200 },
      head,
      feetY: FEET,
    });
    expect(s.plate!.y).toBeGreaterThanOrEqual(FEET);
    expect(s.fx!.y).toBeGreaterThanOrEqual(s.plate!.y + s.plate!.h);
    expect(overlaps(s.fx!, head)).toBe(false);
  });
});

describe('weatherAnchorY', () => {
  it('hangs from the stack top when the stack stands above the head', () => {
    expect(weatherAnchorY(250, 300)).toBe(250);
  });

  it('falls back to the head top when the stack is below the feet (back view, wall flip)', () => {
    expect(weatherAnchorY(340, 300)).toBe(300);
    expect(weatherAnchorY(null, 300)).toBe(300);
  });
});
