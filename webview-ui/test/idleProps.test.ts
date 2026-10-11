/**
 * What an idle agent holds and the Zz over a napper: each agent keeps its own book cover and mug
 * body, the steam loops, and the Zz are two glyphs that rise from the spawn point and fade.
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import { ART_DENSITY } from '../../core/src/assets/constants.js';
import { IDLE_PROP_STEAM_FRAME_SEC, NAP_ZZ_PERIOD_MS } from '../src/constants.js';
import {
  bookPlacement,
  mugPlacement,
  napZzPlacements,
  steamPlacement,
} from '../src/office/flair/idleProps.js';
import ANCHORS from '../src/office/sprites/flair/anchors.json';
import idleProps from '../src/office/sprites/flair/idle-props.json';
import zz from '../src/office/sprites/flair/zz.json';

const AGENTS = Array.from({ length: 24 }, (_, i) => i + 1);

describe('seeded props', () => {
  it('give an agent the same cover and mug every time, and spread the variants over agents', () => {
    for (const id of AGENTS) {
      expect(bookPlacement(0, 9, id).sprite).toBe(bookPlacement(0, 9, id).sprite);
      expect(mugPlacement(id).sprite).toBe(mugPlacement(id).sprite);
    }
    const covers = new Set(AGENTS.map((id) => bookPlacement(0, 9, id).sprite));
    const bodies = new Set(AGENTS.map((id) => mugPlacement(id).sprite));
    expect(covers.size).toBe(idleProps.book.covers.length);
    expect(bodies.size).toBe(idleProps.mug.bodies.length);
  });
});

describe('steam', () => {
  it('loops through its frames above the mug', () => {
    const n = idleProps.steam.frames.length;
    const frames = Array.from({ length: n + 1 }, (_, i) =>
      steamPlacement((i + 0.5) * IDLE_PROP_STEAM_FRAME_SEC),
    );
    expect(new Set(frames.slice(0, n).map((f) => f!.sprite)).size).toBe(n);
    expect(frames[n]!.sprite).toBe(frames[0]!.sprite);
    expect([frames[0]!.dx, frames[0]!.dy]).toEqual([idleProps.steam.dx, idleProps.steam.dy]);
  });
});

describe('napping Zz', () => {
  it('are at most two glyphs, a small and a large, that rise from the spawn point and fade', () => {
    const start = napZzPlacements(0);
    expect(start).toHaveLength(2);
    expect(start[0].sprite.length).toBeLessThan(start[1].sprite.length);
    // the small one is just born at the spawn point, fully opaque
    expect([start[0].dx, start[0].dy, start[0].alpha]).toEqual([zz.dx, zz.dy, 1]);
    // later in its cycle it is higher and fainter
    const later = napZzPlacements(NAP_ZZ_PERIOD_MS * 0.4)[0];
    expect(later.dy).toBeLessThan(zz.dy);
    expect(later.alpha).toBeLessThan(1);
    for (const t of [0, 300, 1200, 2399]) expect(napZzPlacements(t)).toHaveLength(2);
  });

  it('start above the head, not on the back of it, when the napper faces away', () => {
    // From behind the head is upright: every glyph's bottom must clear the head top.
    for (const t of [0, 600, 1200, 1800]) {
      for (const g of napZzPlacements(t, false)) {
        expect(g.dy + g.sprite.length / ART_DENSITY).toBeLessThanOrEqual(ANCHORS.up.headTopY);
      }
    }
  });
});
