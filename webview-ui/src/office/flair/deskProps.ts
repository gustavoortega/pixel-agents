import { DESK_PROP_REACH_TILES, DESK_PROP_SLOTS_MAX } from '../../constants.js';

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
export function unlockProps(level: number): DeskPropKind[] {
  return UNLOCKS.filter((u) => level >= u.level)
    .map((u) => u.kind)
    .slice(-DESK_PROP_SLOTS_MAX);
}

export interface Tile {
  col: number;
  row: number;
}

const key = (t: Tile): string => `${t.col},${t.row}`;

/**
 * The monitor a seat faces within `depth` tiles, or null. Stand-in for the seat-to-PC lookup the
 * seating rework provides; the merge replaces this one function.
 */
export function pcTileForSeat(input: {
  seat: Tile;
  facing: Tile;
  depth: number;
  electronicsTiles: ReadonlySet<string>;
}): Tile | null {
  const { seat, facing, depth, electronicsTiles } = input;
  for (let d = 1; d <= depth; d++) {
    const t = { col: seat.col + facing.col * d, row: seat.row + facing.row * d };
    if (electronicsTiles.has(key(t))) return t;
  }
  return null;
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
}): Tile[] {
  const { pc, across, deskTiles, electronicsTiles, blocked } = input;
  const companion = companionDeskTile(pc);
  const out: Tile[] = [];
  for (let d = 1; d <= DESK_PROP_REACH_TILES; d++) {
    for (const sign of [-1, 1]) {
      const t = { col: pc.col + across.col * d * sign, row: pc.row + across.row * d * sign };
      if (!deskTiles.has(key(t))) continue;
      if (electronicsTiles.has(key(t)) || key(t) === key(companion) || blocked?.has(key(t)))
        continue;
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
