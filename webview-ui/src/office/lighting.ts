/**
 * The warm-light pass: which phase of the day it is, where the glows go and how
 * they are cached. Pure geometry and tables with no canvas or DOM access, so the
 * renderer, the DOM tint and the tests all ask the same functions.
 *
 * The tint is a DOM layer (the canvas is transparent outside the map) and the glows
 * are canvas draws clipped to the map; both take their strength from `lightingFor`.
 */

import { ART_DENSITY } from '../../../core/src/assets/constants.js';
import { fairyBulbCenters } from '../../../core/src/assets/fairyLights.js';
import {
  FAIRY_GLOW_MIN,
  FAIRY_GLOW_RADIUS_TILES,
  FAIRY_PHASE_STEP,
  FAIRY_TWINKLE_MS,
  GLOW_DOWN_OFFSET_TILES,
  GLOW_LAMP_RADIUS_TILES,
  GLOW_MONITOR_RADIUS_TILES,
  LAMP_HEAD_OFFSET_PX,
  LIGHT_DAWN_START_MIN,
  LIGHT_DAY_START_MIN,
  LIGHT_FIXTURE_FAIRY,
  LIGHT_FIXTURE_LAMP,
  LIGHT_GOLDEN_START_MIN,
  LIGHT_NIGHT_START_MIN,
  LIGHT_PHASES,
  POOL_LAMP_CENTER_ROWS,
  POOL_LAMP_RADIUS_TILES,
  POOL_MONITOR_RADIUS_TILES,
  TILE_SIZE,
} from '../constants.js';
import type { Direction } from './types.js';
import { Direction as Dir } from './types.js';

export type LightPhase = keyof typeof LIGHT_PHASES;

export interface Lighting {
  phase: LightPhase;
  /** Color and alpha of the DOM tint, or null for plain daylight. */
  tint: { color: string; alpha: number } | null;
  monitorGlow: number;
  lampGlow: number;
}

/** Phase for a local time. Boundaries are inclusive at the start: 07:00 is day, 16:00 golden. */
export function lightingFor(hour: number, minute: number): Lighting {
  const t = hour * 60 + minute;
  let phase: LightPhase;
  if (t >= LIGHT_NIGHT_START_MIN || t < LIGHT_DAWN_START_MIN) phase = 'night';
  else if (t < LIGHT_DAY_START_MIN) phase = 'dawn';
  else if (t < LIGHT_GOLDEN_START_MIN) phase = 'day';
  else phase = 'golden';
  const p = LIGHT_PHASES[phase];
  return {
    phase,
    tint: p.tint ? { ...p.tint } : null,
    monitorGlow: p.monitorGlow,
    lampGlow: p.lampGlow,
  };
}

/** The night phase (the tint's): night windows, floor pools and fairy lights follow it. */
export function isNightPhase(hour: number, minute: number): boolean {
  return lightingFor(hour, minute).phase === 'night';
}

/** Sun glyph from dawn to the end of the golden hour, moon otherwise. */
export function isDaytime(hour: number, minute: number): boolean {
  return lightingFor(hour, minute).phase !== 'night';
}

export function clockLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// ── Glow placement ──────────────────────────────────────────────

export type GlowKind = 'monitor' | 'lamp' | 'lampPool' | 'monitorPool' | 'fairy';

/** A seated agent's monitor: the seat tile, the way it faces, and whether it is working. */
export interface GlowSource {
  seatCol: number;
  seatRow: number;
  facing: Direction;
  active: boolean;
}

export interface FixturePoint {
  col: number;
  row: number;
}

export interface GlowFixtures {
  lamps: readonly FixturePoint[];
  /** Top-left tile of each fairy-light strand. */
  fairyLights: readonly FixturePoint[];
}

/** One glow to paint: the destination rect in device px, already clipped to the map, and the
 *  matching offset into the cached glow sprite. */
export interface GlowDraw {
  kind: GlowKind;
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  alpha: number;
}

const FACING_STEP: Record<Direction, { dc: number; dr: number }> = {
  [Dir.DOWN]: { dc: 0, dr: 1 },
  [Dir.LEFT]: { dc: -1, dr: 0 },
  [Dir.RIGHT]: { dc: 1, dr: 0 },
  [Dir.UP]: { dc: 0, dr: -1 },
};

const RADIUS_TILES: Record<GlowKind, number> = {
  monitor: GLOW_MONITOR_RADIUS_TILES,
  lamp: GLOW_LAMP_RADIUS_TILES,
  lampPool: POOL_LAMP_RADIUS_TILES,
  monitorPool: POOL_MONITOR_RADIUS_TILES,
  fairy: FAIRY_GLOW_RADIUS_TILES,
};

/** Size of the cached sprite for a glow kind, in device px. */
export function glowSize(kind: GlowKind, zoom: number): { w: number; h: number } {
  const radius = RADIUS_TILES[kind] * TILE_SIZE * zoom;
  return { w: 2 * radius, h: 2 * radius };
}

interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clip `rect` to `bounds`; null when nothing is left. */
function clipRect(rect: PxRect, bounds: PxRect): (PxRect & { sx: number; sy: number }) | null {
  const x0 = Math.max(rect.x, bounds.x);
  const y0 = Math.max(rect.y, bounds.y);
  const x1 = Math.min(rect.x + rect.w, bounds.x + bounds.w);
  const y1 = Math.min(rect.y + rect.h, bounds.y + bounds.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, sx: x0 - rect.x, sy: y0 - rect.y };
}

/**
 * Every glow to paint this frame. A DOWN-facing agent is lit on the face (glow on the seat
 * tile), any other facing on the desk it looks at; either is centred half a tile lower so the
 * light falls on the desk side. A monitor glow is never clipped above the topmost of the seat
 * and desk rows: that row boundary is where the wall above the pod starts. Nothing is drawn
 * with the setting off, for idle agents, or for a kind whose strength is 0 in this phase.
 */
export function glowDraws(input: {
  enabled: boolean;
  lighting: Lighting;
  sources: readonly GlowSource[];
  fixtures: GlowFixtures;
  zoom: number;
  offsetX: number;
  offsetY: number;
  cols: number;
  rows: number;
}): GlowDraw[] {
  const { enabled, lighting, sources, fixtures, zoom, offsetX, offsetY, cols, rows } = input;
  if (!enabled) return [];
  const s = TILE_SIZE * zoom;
  const map: PxRect = { x: offsetX, y: offsetY, w: cols * s, h: rows * s };
  const out: GlowDraw[] = [];

  const push = (kind: GlowKind, rect: PxRect, bounds: PxRect, alpha: number): void => {
    const clipped = clipRect(rect, bounds);
    if (clipped) out.push({ kind, ...clipped, alpha });
  };

  if (lighting.monitorGlow > 0) {
    const { w, h } = glowSize('monitor', zoom);
    for (const src of sources) {
      if (!src.active) continue;
      const step = FACING_STEP[src.facing];
      const deskCol = src.seatCol + step.dc;
      const deskRow = src.seatRow + step.dr;
      const anchor =
        src.facing === Dir.DOWN
          ? { col: src.seatCol, row: src.seatRow }
          : { col: deskCol, row: deskRow };
      const cx = offsetX + (anchor.col + 0.5) * s;
      const cy = offsetY + (anchor.row + 0.5 + GLOW_DOWN_OFFSET_TILES) * s;
      const topRow = Math.min(src.seatRow, deskRow);
      const top = Math.max(map.y, offsetY + topRow * s);
      const bounds: PxRect = { x: map.x, y: top, w: map.w, h: map.y + map.h - top };
      push('monitor', { x: cx - w / 2, y: cy - h / 2, w, h }, bounds, lighting.monitorGlow);
    }
  }

  if (lighting.lampGlow > 0) {
    const { w, h } = glowSize('lamp', zoom);
    for (const lamp of fixtures.lamps) {
      const cx = offsetX + (lamp.col + 0.5) * s;
      const cy = offsetY + lamp.row * s + LAMP_HEAD_OFFSET_PX * zoom;
      push('lamp', { x: cx - w / 2, y: cy - h / 2, w, h }, map, lighting.lampGlow);
    }
  }

  return out;
}

/** Light-emitting furniture in a layout, wherever it was placed. */
export function lightFixtures(
  furniture: ReadonlyArray<{ type: string; col: number; row: number }>,
): GlowFixtures {
  const lamps: FixturePoint[] = [];
  const fairyLights: FixturePoint[] = [];
  for (const f of furniture) {
    if (f.type === LIGHT_FIXTURE_LAMP) lamps.push({ col: f.col, row: f.row });
    if (f.type === LIGHT_FIXTURE_FAIRY) fairyLights.push({ col: f.col, row: f.row });
  }
  return { lamps, fairyLights };
}

/** Fairy-bulb centers in world px from a strand's top-left, read off the shared art geometry. */
const FAIRY_BULBS = fairyBulbCenters().map((b) => ({ x: b.x / ART_DENSITY, y: b.y / ART_DENSITY }));

/** Twinkle strength of bulb `i` at `nowMs`: the same FAIRY_TWINKLE_MS wave, shifted per bulb. */
function twinkle(i: number, nowMs: number): number {
  const phase = nowMs / FAIRY_TWINKLE_MS + i * FAIRY_PHASE_STEP;
  return FAIRY_GLOW_MIN + (1 - FAIRY_GLOW_MIN) * (0.5 + 0.5 * Math.sin(2 * Math.PI * phase));
}

/**
 * The night lights, only while `night` holds (isNightPhase) and the setting is on:
 * floor pools under every floor lamp and every active monitor (`pools`, painted on the floor under
 * the furniture), and a twinkling glow on each fairy-light bulb (`fairy`, painted over the scene).
 * `monitors` is the tile of each lit PC, the same set that shows the ON frames.
 */
export function nightLightDraws(input: {
  enabled: boolean;
  night: boolean;
  fixtures: GlowFixtures;
  monitors: readonly FixturePoint[];
  nowMs: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  cols: number;
  rows: number;
}): { pools: GlowDraw[]; fairy: GlowDraw[] } {
  const { enabled, night, fixtures, monitors, nowMs, zoom, offsetX, offsetY, cols, rows } = input;
  const pools: GlowDraw[] = [];
  const fairy: GlowDraw[] = [];
  if (!enabled || !night) return { pools, fairy };
  const s = TILE_SIZE * zoom;
  const map: PxRect = { x: offsetX, y: offsetY, w: cols * s, h: rows * s };
  const at = (out: GlowDraw[], kind: GlowKind, cx: number, cy: number, alpha: number): void => {
    const { w, h } = glowSize(kind, zoom);
    const clipped = clipRect({ x: cx - w / 2, y: cy - h / 2, w, h }, map);
    if (clipped) out.push({ kind, ...clipped, alpha });
  };

  for (const lamp of fixtures.lamps) {
    at(
      pools,
      'lampPool',
      offsetX + (lamp.col + 0.5) * s,
      offsetY + (lamp.row + POOL_LAMP_CENTER_ROWS) * s,
      1,
    );
  }
  for (const m of monitors) {
    at(pools, 'monitorPool', offsetX + (m.col + 0.5) * s, offsetY + (m.row + 0.5) * s, 1);
  }
  for (const strand of fixtures.fairyLights) {
    FAIRY_BULBS.forEach((b, i) => {
      at(
        fairy,
        'fairy',
        offsetX + (strand.col * TILE_SIZE + b.x) * zoom,
        offsetY + (strand.row * TILE_SIZE + b.y) * zoom,
        twinkle(i, nowMs),
      );
    });
  }
  return { pools, fairy };
}

/** Seated agents whose status is active: the ones whose monitor is lit. The pose does not
 *  matter, a working agent walking to its desk still has the screen on. */
export function monitorSources(
  characters: Iterable<{
    seatId: string | null;
    isActive: boolean;
    isSubagent: boolean;
  }>,
  seats: ReadonlyMap<string, { seatCol: number; seatRow: number; facingDir: Direction }>,
): GlowSource[] {
  const out: GlowSource[] = [];
  for (const ch of characters) {
    if (!ch.seatId || ch.isSubagent) continue;
    const seat = seats.get(ch.seatId);
    if (!seat) continue;
    out.push({
      seatCol: seat.seatCol,
      seatRow: seat.seatRow,
      facing: seat.facingDir,
      active: ch.isActive,
    });
  }
  return out;
}

// ── Glow sprite cache ───────────────────────────────────────────

/** Keyed by (kind, zoom): a glow is the same picture for every agent, so it is built once per
 *  zoom and reused. `build` is injected so the cache stays DOM-free. */
export function createGlowCache<T>(build: (kind: GlowKind, zoom: number) => T): {
  get(kind: GlowKind, zoom: number): T;
} {
  const cache = new Map<string, T>();
  return {
    get(kind, zoom) {
      const key = `${kind}:${zoom}`;
      let hit = cache.get(key);
      if (hit === undefined) {
        hit = build(kind, zoom);
        cache.set(key, hit);
      }
      return hit;
    },
  };
}
