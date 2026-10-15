/**
 * The monitor's office: which desk lights for whom (Q3.1), where the tags go (the solver), and
 * where a workflow's banner hangs (Q3.3). Pure geometry, at the zooms the fit picks (2, 3, 4).
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import { crewBannerSize, crewBannerView, placeCrewBanner } from '../src/office/crewBanner.js';
import { attentionTone, deskHighlights, type HighlightSeat } from '../src/office/deskHighlight.js';
import { placeTags, type Rect, type TagItem } from '../src/office/labelLayout.js';

const T = 16;
const hit = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, b: Rect): boolean =>
  r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;

describe('Q3.1 the desk that lights', () => {
  it.each([
    [{ permission: true, question: false, stuck: false }, 'wait'],
    [{ permission: false, question: true, stuck: false }, 'wait'],
    [{ permission: false, question: false, stuck: true }, 'stuck'],
    // Waiting on you outranks stuck, like the plate's tab.
    [{ permission: true, question: false, stuck: true }, 'wait'],
    [{ permission: false, question: false, stuck: false }, null],
  ] as const)('%o lights %s', (facts, tone) => {
    expect(attentionTone(facts)).toBe(tone);
  });

  // Three desks in a row, each 3 tiles wide and 2 tall from row 3; the chairs face down on each
  // desk's back row. Agent 2 is listed first but sits at the last desk.
  const desks = [0, 4, 8].map((col) => ({ x: col * T, y: 3 * T, w: 3 * T, h: 2 * T }));
  const deskAt = (col: number, row: number): Rect | null =>
    desks.find((d) => hit(d, { x: col * T + 1, y: row * T + 1, w: 1, h: 1 })) ?? null;
  const seats = new Map<string, HighlightSeat>([
    ['a', { seatCol: 1, seatRow: 3, facing: { dCol: 0, dRow: 1 } }],
    ['b', { seatCol: 5, seatRow: 3, facing: { dCol: 0, dRow: 1 } }],
    ['c', { seatCol: 9, seatRow: 3, facing: { dCol: 0, dRow: 1 } }],
  ]);

  it("frames each lit agent's own desk, seat and sprite, whatever the order", () => {
    const sprite = { x: 9 * T, y: 2 * T + 5, w: T, h: 27 };
    const lit = deskHighlights(
      [
        { id: 2, tone: 'wait', col: 9, row: 3, seatId: 'c', sprite },
        { id: 7, tone: 'stuck', col: 5, row: 3, seatId: 'b' },
      ],
      seats,
      deskAt,
    );
    expect(lit).toEqual([
      // The desk under the chair, grown up to the head of the agent sitting there.
      { id: 2, tone: 'wait', rect: { x: 8 * T, y: 2 * T + 5, w: 3 * T, h: 3 * T - 5 } },
      { id: 7, tone: 'stuck', rect: desks[1] },
    ]);
  });

  it('a back-view seat under its desk adds its own tile; no seat lights the tile it stands on', () => {
    const back = new Map<string, HighlightSeat>([
      ['d', { seatCol: 5, seatRow: 5, facing: { dCol: 0, dRow: -1 } }],
    ]);
    expect(
      deskHighlights(
        [
          { id: 1, tone: 'wait', col: 5, row: 5, seatId: 'd' },
          { id: 3, tone: 'wait', col: 12, row: 8, seatId: null },
        ],
        back,
        deskAt,
      ).map((h) => h.rect),
    ).toEqual([
      { x: 4 * T, y: 3 * T, w: 3 * T, h: 3 * T },
      { x: 12 * T, y: 8 * T, w: T, h: T },
    ]);
  });
});

/**
 * A top room as the bundled office has it, scaled to a zoom: a wall band of two tiles with
 * windows, four face-on agents one pod (4 tiles) apart, their tags as wide as a long state reads.
 */
function topRow(zoom: number) {
  const z = (v: number) => v * zoom;
  const room: Rect = { x: 0, y: 0, w: z(17 * T), h: z(8 * T) };
  const windows: Rect[] = [7, 13].map((c) => ({ x: z(c * T), y: 0, w: z(2 * T), h: z(2 * T) }));
  const agents = [2, 6, 10, 14].map((col, i) => {
    const headTop = z(2 * T) + 13;
    return {
      id: i + 1,
      body: { x: z(col * T), y: headTop, w: z(T), h: z(T + 5) },
      item: {
        id: i + 1,
        rank: 1,
        col,
        row: 3,
        x: z(col * T + T / 2),
        bottom: headTop - 6,
        w: 130,
        h: 26,
        tagH: 26,
        feetY: headTop + z(T + 5) + 6,
        bounds: room,
      } satisfies TagItem,
    };
  });
  return { room, windows, agents };
}

const SOLVER = { step: 8, maxSteps: 12, pad: 3, attach: 14, sideCost: 1.5 };

describe('the tag solver', () => {
  it.each([2, 3, 4])(
    'at zoom %i every tag is placed, none on another, a body or a window',
    (zoom) => {
      const { windows, agents } = topRow(zoom);
      const bodies = agents.map((a) => a.body);
      const placed = placeTags(
        agents.map((a) => a.item),
        [...bodies, ...windows],
        SOLVER,
      );
      const tags = agents.map((a) => placed.get(a.id)?.tag);
      expect(tags.every((t) => t !== undefined && t !== null)).toBe(true);
      const rects = tags as Rect[];
      for (const [i, t] of rects.entries()) {
        for (const o of [...rects.slice(i + 1), ...bodies, ...windows])
          expect(hit(t, o)).toBe(false);
        // Still over its own character.
        const x = agents[i].item.x;
        expect(t.x < x && x < t.x + t.w).toBe(true);
      }
    },
  );

  it('a tag with no free spot in its room is not placed at all', () => {
    const room = { x: 0, y: 0, w: 100, h: 60 };
    const item: TagItem = {
      id: 1,
      rank: 1,
      col: 0,
      row: 0,
      x: 50,
      bottom: 30,
      w: 80,
      h: 20,
      tagH: 20,
      feetY: 40,
      bounds: room,
    };
    expect(placeTags([item], [room], SOLVER).get(1)).toBeNull();
  });
});

describe('Q3.3 the crew banner on its wall', () => {
  const view = crewBannerView(
    {
      status: 'running',
      name: 'review-pr',
      phases: [
        { name: 'scan', started: 1, done: 1 },
        { name: 'review', started: 3, done: 0 },
      ],
      started: 4,
      done: 1,
      since: 0,
    },
    'Linus',
    21 * 60_000,
  );

  it.each([2, 3, 4])('at zoom %i it hangs inside the top wall band over its helpers', (zoom) => {
    // A 12-tile room whose floor starts under a two-tile wall; helpers sit on its second floor row.
    const z = (v: number) => v * zoom;
    const band: Rect = { x: 0, y: 0, w: z(12 * T), h: z(2 * T) };
    const room: Rect = { x: 0, y: 0, w: z(12 * T), h: z(10 * T) };
    const heads = [3, 7].map((c) => ({ x: z(c * T), y: z(4 * T) }));
    const size = crewBannerSize(view, true);
    // The largest scale that fits the band, as the overlay asks for it.
    const k = Math.min(1.5, (band.h - 4) / (size.h + 4));
    const placed = placeCrewBanner({
      wall: { band, sizes: [{ w: size.w * k, h: (size.h + 4) * k }] },
      free: crewBannerSize(view),
      heads,
      room,
      map: room,
      wallAvoid: [],
      avoid: [],
    });
    expect(placed?.onWall).toBe(true);
    expect(inside(placed!.rect, band)).toBe(true);
  });

  it('slides along the wall off a plaque, and leaves the wall when nothing there is free', () => {
    const band: Rect = { x: 0, y: 0, w: 600, h: 96 };
    const room: Rect = { x: 0, y: 0, w: 600, h: 400 };
    const size = { w: 260, h: 80 };
    const heads = [{ x: 60, y: 200 }];
    const plaque: Rect = { x: 24, y: 30, w: 80, h: 30 };
    const wall = placeCrewBanner({
      wall: { band, sizes: [size] },
      free: size,
      heads,
      room,
      map: room,
      wallAvoid: [plaque],
      avoid: [],
    });
    expect(wall?.onWall).toBe(true);
    expect(hit(wall!.rect, plaque)).toBe(false);
    const off = placeCrewBanner({
      wall: { band, sizes: [size] },
      free: size,
      heads,
      room,
      map: room,
      wallAvoid: [band],
      avoid: [],
    });
    expect(off?.onWall).toBe(false);
  });
});
