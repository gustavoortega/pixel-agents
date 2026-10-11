import { useEffect, useState } from 'react';

import { HUD_CLOCK_REFRESH_MS } from '../constants.js';
import { clockLabel, isDaytime } from '../office/lighting.js';

/** Pixel glyphs on a 7x7 grid: a sun by day, a moon at night. */
const SUN = ['..#.#..', '.#####.', '#######', '.#####.', '#######', '.#####.', '..#.#..'];
const MOON = ['..###..', '.##....', '##.....', '##.....', '##.....', '.##...#', '..#####'];
const GLYPH_CELL_PX = 3;

function Glyph({ rows, fill }: { rows: string[]; fill: string }) {
  return (
    <svg
      width={rows[0].length * GLYPH_CELL_PX}
      height={rows.length * GLYPH_CELL_PX}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === '#' ? (
            <rect
              key={`${x}-${y}`}
              x={x * GLYPH_CELL_PX}
              y={y * GLYPH_CELL_PX}
              width={GLYPH_CELL_PX}
              height={GLYPH_CELL_PX}
              fill={fill}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

/** Top-left pill: sun or moon glyph and the local time. */
export function HudClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), HUD_CLOCK_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  const day = isDaytime(now.getHours(), now.getMinutes());
  return (
    <div
      className="absolute top-8 left-8 z-10 flex items-center gap-8 brand-panel py-4 px-10 select-none pointer-events-none"
      data-testid="hud-clock"
    >
      <Glyph rows={day ? SUN : MOON} fill={day ? 'var(--brand-gold)' : 'var(--brand-rust)'} />
      <span className="text-sm leading-none">{clockLabel(now.getHours(), now.getMinutes())}</span>
    </div>
  );
}
