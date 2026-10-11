import { useEffect, useState } from 'react';

import { ART_DENSITY } from '../../../core/src/assets/constants.js';
import { HUD_ACTIVE_REFRESH_MS, HUD_CLOCK_REFRESH_MS, ZOOM_MAX, ZOOM_MIN } from '../constants.js';
import { countActiveAgents } from '../office/activeAgents.js';
import { stepZoom } from '../office/camera.js';
import { clockLabel, isDaytime } from '../office/lighting.js';
import type { Character } from '../office/types.js';
import { Button } from './ui/Button.js';

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

interface HudCardProps {
  /** Live characters; read on a timer because their status is not React state. */
  characters: { values: () => Iterable<Pick<Character, 'isActive' | 'isSubagent'>> };
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Auto-fit is following the rooms where agents work. */
  fitActive: boolean;
  /** Frame the working rooms again and keep following them. */
  onFit: () => void;
}

/** Top-left cream card. Line 1: sun/moon, time, active count. Line 2: zoom out, in, fit, level. */
export function HudCard({ characters, zoom, onZoomChange, fitActive, onFit }: HudCardProps) {
  const [now, setNow] = useState(() => new Date());
  const [active, setActive] = useState(() => countActiveAgents(characters.values()));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), HUD_CLOCK_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const read = () => setActive(countActiveAgents(characters.values()));
    read();
    const id = setInterval(read, HUD_ACTIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [characters]);
  const day = isDaytime(now.getHours(), now.getMinutes());
  const btn = 'text-2xs leading-none min-w-28';
  return (
    <div
      className="absolute top-8 left-8 z-10 brand-panel py-6 px-10 flex flex-col gap-6 text-2xs leading-none select-none"
      data-testid="hud-card"
    >
      <div className="flex items-center gap-8 pointer-events-none">
        <Glyph rows={day ? SUN : MOON} fill={day ? 'var(--brand-gold)' : 'var(--brand-rust)'} />
        <span>{clockLabel(now.getHours(), now.getMinutes())}</span>
        <span>{active} active</span>
      </div>
      <div className="flex items-center gap-6">
        <Button
          size="sm"
          variant="brand"
          className={btn}
          onClick={() => onZoomChange(stepZoom(zoom, -1))}
          disabled={zoom <= ZOOM_MIN}
          title="Zoom out (Ctrl+Scroll)"
          aria-label="Zoom out"
        >
          -
        </Button>
        <Button
          size="sm"
          variant="brand"
          className={btn}
          onClick={() => onZoomChange(stepZoom(zoom, 1))}
          disabled={zoom >= ZOOM_MAX}
          title="Zoom in (Ctrl+Scroll)"
          aria-label="Zoom in"
        >
          +
        </Button>
        <Button
          size="sm"
          variant={fitActive ? 'brandActive' : 'brand'}
          className={btn}
          onClick={onFit}
          title="Fit the view to the rooms in use"
          aria-label="Fit the view to the rooms in use"
          aria-pressed={fitActive}
        >
          Fit
        </Button>
        {/* Art px per device px: the ladder reads 0.5x, 1x, 2x, ... 10x */}
        <span title="Zoom level" data-testid="zoom-level">
          {zoom / ART_DENSITY}x
        </span>
      </div>
    </div>
  );
}
