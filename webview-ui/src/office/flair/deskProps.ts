import { DESK_PROP_REACH_TILES, DESK_PROP_SLOTS_MAX } from '../../constants.js';
import type { Direction } from '../types.js';
import { Direction as Dir } from '../types.js';

/**
 * Desk props an agent earns by level. Pure tables and slot picking; sprites live in
 * sprites/deskPropSprites.ts and the draw hook in the renderer.
 */

export const DeskPropKind = {
  PLANT: 'plant',
  LAMP: 'lamp',
  PHOTO: 'photo',
  TROPHY: 'trophy',
} as const;
export type DeskPropKind = (typeof DeskPropKind)[keyof typeof DeskPropKind];

const UNLOCKS: ReadonlyArray<{ level: number; kind: DeskPropKind }> = [
  { level: 5, kind: DeskPropKind.PLANT },
  { level: 10, kind: DeskPropKind.LAMP },
  { level: 15, kind: DeskPropKind.PHOTO },
  { level: 20, kind: DeskPropKind.TROPHY },
];

/** The latest props a level has unlocked, oldest first. Older ones retire so a desk never crowds. */
function unlockProps(level: number): DeskPropKind[] {
  return UNLOCKS.filter((u) => level >= u.level)
    .map((u) => u.kind)
    .slice(-DESK_PROP_SLOTS_MAX);
}

export interface Tile {
  col: number;
  row: number;
}

const key = (t: Tile): string => `${t.col},${t.row}`;

export interface PcSeat {
  uid: string;
  col: number;
  row: number;
  facing: Direction;
}

export interface PcItem {
  uid: string;
  /** Catalog orientation of the placed item: front, back, side, left or right. */
  orientation?: string;
  /** Every footprint tile. */
  tiles: readonly Tile[];
}

/** The screen a seat can use looks back at it: a seat facing down meets a PC shown from behind
 *  (`back`), one facing up a PC shown from the front, a sideways seat a side PC (mirrored). */
function orientationFits(facing: Direction, orientation: string | undefined): boolean {
  if (facing === Dir.DOWN) return orientation === 'back';
  if (facing === Dir.UP) return orientation === 'front';
  return orientation === 'side' || orientation === 'left' || orientation === 'right';
}

const FRONT_OFFSET: Record<Direction, Tile> = {
  [Dir.DOWN]: { col: 0, row: 1 },
  [Dir.UP]: { col: 0, row: -1 },
  [Dir.LEFT]: { col: -1, row: 0 },
  [Dir.RIGHT]: { col: 1, row: 0 },
};

/** The tile of `tiles` nearest to `from` by Manhattan distance, ties to the lower column then row. */
export function nearestTile(from: Tile, tiles: readonly Tile[]): Tile | null {
  let best: Tile | null = null;
  let bestD = Infinity;
  for (const t of tiles) {
    const d = Math.abs(t.col - from.col) + Math.abs(t.row - from.row);
    if (
      d < bestD ||
      (d === bestD && best && (t.col < best.col || (t.col === best.col && t.row < best.row)))
    ) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * The PC each seat owns, seat uid -> furniture uid. A candidate faces the seat (see
 * `orientationFits`) and has a footprint tile within one tile (Chebyshev) of the cell in front of
 * the seat; the nearest to the seat wins, ties to the lower column. One PC per seat is what keeps
 * a face-to-face pod from lighting the opposite desk's screen. Seats with no PC are absent.
 */
export function pcForSeat(seats: readonly PcSeat[], pcs: readonly PcItem[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const seat of seats) {
    const off = FRONT_OFFSET[seat.facing];
    const front = { col: seat.col + off.col, row: seat.row + off.row };
    let best: { uid: string; tile: Tile; d: number } | null = null;
    for (const pc of pcs) {
      if (!orientationFits(seat.facing, pc.orientation)) continue;
      const near = pc.tiles.some(
        (t) => Math.max(Math.abs(t.col - front.col), Math.abs(t.row - front.row)) <= 1,
      );
      if (!near) continue;
      const tile = nearestTile({ col: seat.col, row: seat.row }, pc.tiles)!;
      const d = Math.abs(tile.col - seat.col) + Math.abs(tile.row - seat.row);
      if (!best || d < best.d || (d === best.d && tile.col < best.tile.col)) {
        best = { uid: pc.uid, tile, d };
      }
    }
    if (best) out.set(seat.uid, best.uid);
  }
  return out;
}

/** The desk tile a companion takes: one tile right of the monitor. */
export function companionDeskTile(pc: Tile): Tile {
  return { col: pc.col + 1, row: pc.row };
}

/**
 * Desk surface cells a prop may stand on: the desk run through the monitor along the desk's
 * width, nearest first (left before right), minus the monitor, the companion's cell and any
 * other electronics. A gap in the desk ends the run on that side.
 */
export function deskSlots(input: {
  pc: Tile;
  /** Unit step along the desk's width, perpendicular to the seat's facing. */
  across: Tile;
  deskTiles: ReadonlyMap<string, number>;
  electronicsTiles: ReadonlySet<string>;
  /** Cells already spoken for, such as another agent's companion cell. */
  blocked?: ReadonlySet<string>;
  /** The agent's seat: a prop in its line of sight would be drawn over the agent. */
  seat?: Tile;
}): Tile[] {
  const { pc, across, deskTiles, electronicsTiles, blocked, seat } = input;
  const companion = companionDeskTile(pc);
  const out: Tile[] = [];
  for (let d = 1; d <= DESK_PROP_REACH_TILES; d++) {
    for (const sign of [-1, 1]) {
      const t = { col: pc.col + across.col * d * sign, row: pc.row + across.row * d * sign };
      if (!deskTiles.has(key(t))) continue;
      if (electronicsTiles.has(key(t)) || key(t) === key(companion) || blocked?.has(key(t)))
        continue;
      // Slots run along the desk, so the one cell in the seat's own line is right in front of it.
      if (seat && (across.col !== 0 ? t.col === seat.col : t.row === seat.row)) continue;
      out.push(t);
    }
  }
  return out;
}

export interface DeskPropPlacement {
  kind: DeskPropKind;
  tile: Tile;
}

/** Props in slot order; with a single slot only the latest unlock is shown. */
export function propPlacements(level: number, slots: readonly Tile[]): DeskPropPlacement[] {
  const kinds = unlockProps(level);
  const shown = slots.length >= kinds.length ? kinds : kinds.slice(kinds.length - slots.length);
  return shown.map((kind, i) => ({ kind, tile: slots[i] }));
}
