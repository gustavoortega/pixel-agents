/**
 * The medal: an agent's model tier and how full its context is, in one 12 px badge. A ring filled
 * clockwise from twelve o'clock by the context fraction (coral once it is nearly full) around the
 * tier glyph: a dot, a square, a diamond, a cross. Pure, so the plate, the rail and the tests share
 * one picture.
 */

import type { ModelTier } from '../../../core/src/provider.js';
import {
  MEDAL_GRID,
  MEDAL_HOLE_COLOR,
  MEDAL_HOT_FRACTION,
  MEDAL_RING_FILL_COLOR,
  MEDAL_RING_HOT_COLOR,
  MEDAL_RING_INNER,
  MEDAL_RING_OUTER,
  MEDAL_RING_TRACK_COLOR,
  MEDAL_TIER_FILL,
  MEDAL_TIER_HI,
} from '../constants.js';

/** What a medal shows. `fraction` null: the context is unknown, so the ring is track only. */
export interface MedalSpec {
  tier: ModelTier | null;
  fraction: number | null;
}

/** The context fraction of an agent, or null when it has not reported one (never 0). */
export function contextFraction(contextTokens: number, maxContextTokens: number): number | null {
  if (!(contextTokens > 0) || !(maxContextTokens > 0)) return null;
  return Math.min(1, contextTokens / maxContextTokens);
}

/** The glyph in the hole, 6 x 6: f fill, h highlight. */
const TIER_GLYPH: Record<ModelTier, readonly string[]> = {
  1: ['......', '..ff..', '.fhff.', '.ffff.', '..ff..', '......'],
  2: ['......', '.fffh.', '.ffff.', '.ffff.', '.ffff.', '......'],
  3: ['..ff..', '.fhff.', 'ffffff', 'ffffff', '.ffff.', '..ff..'],
  4: ['..ff..', '..fh..', 'ffffff', 'ffffff', '..ff..', '..ff..'],
};

/** One horizontal run of same-colored pixels. */
export interface MedalRun {
  x: number;
  y: number;
  w: number;
  color: string;
}

/** Whole percent the ring shows: the memo key and the label agree on it. */
export function medalPercent(fraction: number): number {
  return Math.round(fraction * 100);
}

export function medalIsHot(fraction: number | null): boolean {
  return fraction !== null && fraction >= MEDAL_HOT_FRACTION;
}

/**
 * The medal as rows of runs on the 12 px grid. Each pixel is the ring (filled or track), the hole,
 * or the glyph; outside the ring is empty.
 */
export function medalRuns(spec: MedalSpec): MedalRun[] {
  const c = MEDAL_GRID / 2;
  const filled = spec.fraction === null ? 0 : medalPercent(spec.fraction) / 100;
  const ring = medalIsHot(spec.fraction) ? MEDAL_RING_HOT_COLOR : MEDAL_RING_FILL_COLOR;
  const glyph = spec.tier === null ? null : TIER_GLYPH[spec.tier];
  const offset = (MEDAL_GRID - 6) / 2;
  const runs: MedalRun[] = [];
  for (let y = 0; y < MEDAL_GRID; y++) {
    let run: MedalRun | null = null;
    for (let x = 0; x < MEDAL_GRID; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      let color: string | null = null;
      if (d <= MEDAL_RING_OUTER) {
        if (d < MEDAL_RING_INNER) {
          color = MEDAL_HOLE_COLOR;
          const g = glyph?.[y - offset]?.charAt(x - offset);
          if (spec.tier !== null && g === 'f') color = MEDAL_TIER_FILL[spec.tier];
          if (spec.tier !== null && g === 'h') color = MEDAL_TIER_HI[spec.tier];
        } else {
          // Clockwise from twelve o'clock, 0..1.
          let a = Math.atan2(dx, -dy) / (2 * Math.PI);
          if (a < 0) a += 1;
          color = a < filled ? ring : MEDAL_RING_TRACK_COLOR;
        }
      }
      if (run && run.color === color && run.x + run.w === x) {
        run.w++;
        continue;
      }
      if (run) runs.push(run);
      run = color === null ? null : { x, y, w: 1, color };
    }
    if (run) runs.push(run);
  }
  return runs;
}
