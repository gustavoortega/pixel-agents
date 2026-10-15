/**
 * The monitor's office: which desk lights for whom (Q3.1), where the tags go (the solver), and
 * where a workflow's banner hangs (Q3.3). Pure geometry, at the zooms the fit picks (2, 3, 4).
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import {
  DESK_HIGHLIGHT_INK,
  DESK_HIGHLIGHT_STUCK_COLOR,
  DESK_HIGHLIGHT_STUCK_FILL,
  DESK_HIGHLIGHT_WAIT_COLOR,
  DESK_HIGHLIGHT_WAIT_FILL,
} from '../src/constants.js';
import { crewBannerSize, crewBannerView, placeCrewBanner } from '../src/office/crewBanner.js';
import {
  attentionTone,
  deskHighlightFill,
  deskHighlightFrame,
  deskHighlights,
  type HighlightSeat,
} from '../src/office/deskHighlight.js';
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
 * windows, four face-on agents one pod (4 tiles) apart at desks two tiles deep, their tags as wide
 * as a long state reads. Each tag's slots: under its desk, then above its head.
 */
function topRow(zoom: number, tagW = 120) {
  const z = (v: number) => v * zoom;
  const room: Rect = { x: 0, y: 0, w: z(17 * T), h: z(8 * T) };
  const windows: Rect[] = [7, 13].map((c) => ({ x: z(c * T), y: 0, w: z(2 * T), h: z(2 * T) }));
  const agents = [2, 6, 10, 14].map((col, i) => {
    const headTop = z(2 * T) + 13;
    const body = { x: z(col * T), y: headTop, w: z(T), h: z(T + 5) };
    const desk = { x: z((col - 1) * T), y: headTop, w: z(3 * T), h: z(3 * T) - 13 };
    const tagH = 26;
    return {
      id: i + 1,
      body,
      desk,
      item: {
        id: i + 1,
        rank: 1,
        col,
        row: 3,
        w: tagW,
        tagH,
        slots: [
          { x: z(col * T + T / 2), y: desk.y + desk.h + 4, h: tagH, below: true, anchor: desk },
          { x: z(col * T + T / 2), y: headTop - 6 - tagH, h: tagH, below: false, anchor: body },
        ],
        bounds: room,
      } satisfies TagItem,
    };
  });
  return { room, windows, agents };
}

const SOLVER = { step: 8, leaderAt: 8, reach: 24, farReach: 64, pad: 3, sideCost: 1.5 };

describe('the tag solver', () => {
  it.each([2, 3, 4])(
    'at zoom %i every tag goes under its own desk, none on another, a body or a window',
    (zoom) => {
      const { windows, agents } = topRow(zoom, zoom * 40);
      const bodies = agents.map((a) => a.body);
      const placed = placeTags(
        agents.map((a) => a.item),
        [...bodies, ...windows],
        SOLVER,
      );
      const hits = agents.map((a) => placed.get(a.id));
      expect(hits.every((h) => h?.below && !h.leader)).toBe(true);
      const rects = hits.map((h) => h!.tag);
      for (const [i, t] of rects.entries()) {
        for (const o of [...rects.slice(i + 1), ...bodies, ...windows])
          expect(hit(t, o)).toBe(false);
        // Under its own desk, still over its own character.
        const { desk, item } = agents[i];
        expect(t.y).toBeGreaterThanOrEqual(desk.y + desk.h);
        expect(t.x < item.slots[0].x && item.slots[0].x < t.x + t.w).toBe(true);
      }
    },
  );

  it('a tag whose desk slot is taken goes above the head; one moved past 8 px hangs from a leader', () => {
    const { windows, agents } = topRow(3);
    const [a] = agents;
    const blocked = { ...a.desk, y: a.desk.y + a.desk.h, h: 60 };
    const above = placeTags([a.item], [a.body, ...windows, blocked], SOLVER).get(a.id);
    expect(above?.below).toBe(false);
    expect(above?.leader).toBe(false);
    expect(above!.tag.y + above!.tag.h).toBeLessThanOrEqual(a.body.y);
    // Both slots taken where they stand: the nearest free spot, 16 px down past the block.
    const lower = { ...blocked, h: 12 + 4 + 26 };
    const head = { x: a.body.x - 60, y: 0, w: a.body.w + 120, h: a.body.y };
    const moved = placeTags([a.item], [a.body, lower, head], SOLVER).get(a.id);
    expect(moved?.shift).toBeGreaterThan(8);
    expect(moved?.leader).toBe(true);
  });

  it('a tag never leaves its room, even when its slot hangs past the room edge', () => {
    const room = { x: 0, y: 0, w: 200, h: 100 };
    const desk = { x: 140, y: 40, w: 60, h: 50 };
    const item: TagItem = {
      id: 1,
      rank: 1,
      col: 0,
      row: 0,
      w: 80,
      tagH: 20,
      // Under the desk is past the room's bottom; the head slot is past its right wall.
      slots: [
        { x: 170, y: 94, h: 20, below: true, anchor: desk },
        { x: 170, y: 14, h: 20, below: false, anchor: desk },
      ],
      bounds: room,
    };
    const p = placeTags([item], [desk], SOLVER).get(1);
    expect(p).not.toBeNull();
    expect(inside(p!.tag, room)).toBe(true);
  });

  it('a tag with no free spot in its room is not placed at all', () => {
    const room = { x: 0, y: 0, w: 100, h: 60 };
    const item: TagItem = {
      id: 1,
      rank: 1,
      col: 0,
      row: 0,
      w: 80,
      tagH: 20,
      slots: [{ x: 50, y: 10, h: 20, below: false, anchor: room }],
      bounds: room,
    };
    expect(placeTags([item], [room], SOLVER).get(1)).toBeNull();
  });
});

describe('R1.3 the lit desk is the loudest thing in the room', () => {
  const r = { x: 100, y: 50, w: 96, h: 120 };
  it.each([1, 2])(
    'at dpr %i a 4 px outline in the tile color, a 1 px ink inset and a wash',
    (dpr) => {
      for (const [tone, color, wash] of [
        ['wait', DESK_HIGHLIGHT_WAIT_COLOR, DESK_HIGHLIGHT_WAIT_FILL],
        ['stuck', DESK_HIGHLIGHT_STUCK_COLOR, DESK_HIGHLIGHT_STUCK_FILL],
      ] as const) {
        const ops = deskHighlightFrame(r, tone, 1, dpr);
        const outline = ops.filter((o) => o.color === color);
        expect(outline).toHaveLength(4);
        // Top and bottom bars are the outline's thickness tall, the sides as wide.
        expect(outline.map((o) => Math.min(o.w, o.h))).toEqual([4, 4, 4, 4].map((t) => t * dpr));
        const ink = ops.filter((o) => o.color === DESK_HIGHLIGHT_INK);
        expect(ink.map((o) => Math.min(o.w, o.h))).toEqual([dpr, dpr, dpr, dpr]);
        // The ink runs inside the outline, on the desk's own edge.
        expect(ink[0].y).toBe(r.y);
        expect(deskHighlightFill(r, tone)).toEqual({ color: wash, ...r });
        // A 12% wash: the carpet still reads through it.
        expect(wash).toMatch(/, 0\.12\)$/);
      }
    },
  );

  it('pulses: the halo shows on one frame and not the other', () => {
    const halo = (frame: 0 | 1) =>
      deskHighlightFrame(r, 'wait', frame, 1).filter((o) => o.color.startsWith('rgba')).length;
    expect([halo(0), halo(1)]).toEqual([4, 0]);
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
    const size = crewBannerSize(view, 'wall');
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
