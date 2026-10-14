/**
 * The attention rail's small bitmaps: the medal (the model's tier glyph in its context ring),
 * the bare context ring of a text line, a check mark and an agent's face. Every bitmap is SVG
 * rects with crisp edges or a PNG drawn at a whole device scale, never a font glyph the pixel
 * font lacks.
 */

import { memo } from 'react';

import { MONITOR_RING_HOT_PCT } from '../constants.js';
import { faceDataUrl, faceDevicePx } from '../office/sprites/spriteCache.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';

type Palette = Record<string, string>;

/** One rect per horizontal run of a palette letter; `.` and unknown letters stay clear. */
function Bitmap({
  rows,
  palette,
  scale,
  className,
}: {
  rows: readonly string[];
  palette: Palette;
  scale: number;
  className?: string;
}) {
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  const rects: React.ReactNode[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (!palette[ch]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < w && row[x] === ch) x++;
      rects.push(
        <rect
          key={`${x0}-${y}`}
          x={x0}
          y={y}
          width={x - x0}
          height={1}
          style={{ fill: palette[ch] }}
        />,
      );
    }
  });
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {rects}
    </svg>
  );
}

const donuts = new Map<string, string[]>();

/**
 * A pixel donut on an n px grid, filled clockwise from twelve: f filled, t track, d the hole,
 * and `o` an outline ring out to `edge` (none when `edge` is `outer`).
 */
function donut(n: number, outer: number, inner: number, pct: number, edge = outer): string[] {
  const key = `${n}:${outer}:${inner}:${edge}:${pct}`;
  const hit = donuts.get(key);
  if (hit) return hit;
  const c = n / 2;
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let s = '';
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > edge) s += '.';
      else if (d > outer) s += 'o';
      else if (d < inner) s += 'd';
      else {
        let a = Math.atan2(dx, -dy) / (2 * Math.PI);
        if (a < 0) a += 1;
        s += a < pct / 100 ? 'f' : 't';
      }
    }
    rows.push(s);
  }
  donuts.set(key, rows);
  return rows;
}

/** The tier glyph inside the medal, 6 px: dot, square, diamond, cross (tiers 1-4). */
const TIER_GLYPH: Record<number, readonly string[]> = {
  1: ['......', '..ff..', '.fhff.', '.ffff.', '..ff..', '......'],
  2: ['......', '.fffh.', '.ffff.', '.ffff.', '.ffff.', '......'],
  3: ['..ff..', '.fhff.', 'ffffff', 'ffffff', '.ffff.', '..ff..'],
  4: ['..ff..', '..fh..', 'ffffff', 'ffffff', '..ff..', '..ff..'],
};

/**
 * The medal: the model's tier glyph in its context ring, 12 art px across inside a one-pixel ink
 * outline (so a paper-colored ring still reads on a paper ticket). No context: the track alone.
 * Unknown tier: the hole stays empty.
 */
export const Medal = memo(function Medal({
  tier,
  pct,
  scale,
}: {
  tier: number | undefined;
  /** Whole percent, or undefined when unknown. */
  pct: number | undefined;
  scale: number;
}) {
  const glyph = tier === undefined ? undefined : TIER_GLYPH[tier];
  const rows = donut(14, 6, 3.9, pct ?? 0, 7).map((row, y) => {
    if (!glyph || y < 4 || y >= 10) return row;
    const chars = row.split('');
    for (let gx = 0; gx < 6; gx++) {
      const g = glyph[y - 4][gx];
      if (g === 'f') chars[gx + 4] = 'F';
      else if (g === 'h') chars[gx + 4] = 'H';
    }
    return chars.join('');
  });
  const hot = pct !== undefined && pct >= MONITOR_RING_HOT_PCT;
  return (
    <Bitmap
      rows={rows}
      scale={scale}
      palette={{
        o: 'var(--mon-ink)',
        d: 'var(--medal-hole)',
        f: hot ? 'var(--medal-hot)' : 'var(--medal-ring)',
        t: 'var(--medal-track)',
        F: `var(--tier-${tier}-fill)`,
        H: `var(--tier-${tier}-hi)`,
      }}
    />
  );
});

/** The bare context ring of a text line, 9 px, ink on paper and rust once hot. */
export const Ring = memo(function Ring({ pct, scale }: { pct: number; scale: number }) {
  const rows = donut(9, 4.6, 2.6, pct).map((r) => r.replace(/d/g, '.'));
  return (
    <Bitmap
      rows={rows}
      scale={scale}
      palette={{
        f: pct >= MONITOR_RING_HOT_PCT ? 'var(--mon-rust)' : 'var(--mon-ink)',
        t: 'var(--mon-ring-track)',
      }}
    />
  );
});

const CHECK = ['........kk', '.......kk.', 'kk....kk..', '.kk..kk...', '..kkkk....', '...kk.....'];

/** The font has no ✓: a pixel check instead. */
export function CheckMark({ scale, color }: { scale: number; color: string }) {
  return <Bitmap rows={CHECK} scale={scale} palette={{ k: color }} />;
}

/** An agent's face: the head of its front frame, as its palette and hue shift colour it. */
export function Face({
  palette,
  hueShift,
  boxCss,
}: {
  palette: number;
  hueShift: number;
  boxCss: number;
}) {
  const dpr = window.devicePixelRatio || 1;
  const devicePx = faceDevicePx(boxCss, dpr);
  if (devicePx <= 0) return null;
  const frame = getCharacterSprites(palette, hueShift).walk[Direction.DOWN][0];
  const url = faceDataUrl(`${palette}:${hueShift}`, frame, devicePx);
  if (!url) return null;
  const css = devicePx / dpr;
  return (
    <img
      src={url}
      width={css}
      height={css}
      alt=""
      draggable={false}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    />
  );
}
