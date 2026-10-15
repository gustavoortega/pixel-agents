/**
 * Crew lines: who depends on whom, drawn on the office floor from a lead's seat to each of its
 * drawn helpers, solid to a workflow crew helper, dashed to a sub-agent. A line runs through the
 * aisles (the walkable tiles), so desks and the people in front of it hide what they stand on and
 * it never crosses a face. World px, from the characters' tiles: a line moves only when a
 * character moves, which already wakes the render loop. Pure: the renderer draws what this
 * returns and the e2e hook reads the same list.
 */

import { WORKFLOW_PARENT_TOOL_ID_PREFIX } from '../../../core/src/constants.js';
import { TILE_SIZE } from '../constants.js';
import { isWalkable } from './layout/tileMap.js';
import type { Character, TileType } from './types.js';

export interface CrewLine {
  leadId: number;
  helperId: number;
  kind: 'crew' | 'sub';
  /** Tile centres from the lead's tile to the helper's, corners only, world px. */
  points: ReadonlyArray<{ x: number; y: number }>;
}

interface Tile {
  col: number;
  row: number;
}

const DIRS: readonly Tile[] = [
  { col: 0, row: -1 },
  { col: 0, row: 1 },
  { col: -1, row: 0 },
  { col: 1, row: 0 },
];

/** A turn costs this many steps: of two routes the straighter one wins. */
const TURN_COST = 2;

/** Walkable tiles as a flat grid, rebuilt only when the map or its blocked set changes. */
const gridCache = new WeakMap<TileType[][], { blocked: number; grid: Uint8Array }>();

function walkableGrid(
  tileMap: TileType[][],
  blocked: ReadonlySet<string>,
  cols: number,
  rows: number,
): Uint8Array {
  const hit = gridCache.get(tileMap);
  if (hit && hit.blocked === blocked.size) return hit.grid;
  const grid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      grid[r * cols + c] = isWalkable(c, r, tileMap, blocked as Set<string>) ? 1 : 0;
  gridCache.set(tileMap, { blocked: blocked.size, grid });
  return grid;
}

/**
 * The aisle route between two tiles: fewest steps plus turns over walkable tiles (both ends may
 * be seats, which are blocked to walkers). Corners only. Null when the tiles are not connected.
 */
export function aisleRoute(
  from: Tile,
  to: Tile,
  tileMap: TileType[][],
  blocked: ReadonlySet<string>,
): Tile[] | null {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  const walk = walkableGrid(tileMap, blocked, cols, rows);
  const open = (c: number, r: number): boolean =>
    (c === to.col && r === to.row) || walk[r * cols + c] === 1;
  if (from.col === to.col && from.row === to.row) return [from];
  // Dijkstra over (tile, heading) with a bucket queue: every step costs 1 or 1 + TURN_COST, so
  // the frontier is a ring of buckets by cost and each state is settled once (linear in the map).
  const n = cols * rows * 4;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const ring = TURN_COST + 2;
  const buckets: number[][] = Array.from({ length: ring }, () => []);
  for (let d = 0; d < 4; d++) {
    const s0 = (from.row * cols + from.col) * 4 + d;
    dist[s0] = 0;
    buckets[0].push(s0);
  }
  let goal = -1;
  let pending = 4;
  for (let cost = 0; pending > 0 && goal < 0; cost++) {
    const bucket = buckets[cost % ring];
    while (bucket.length > 0) {
      const s0 = bucket.pop()!;
      pending--;
      if (dist[s0] !== cost) continue;
      const tile = s0 >> 2;
      const heading = s0 & 3;
      const c = tile % cols;
      const r = (tile - c) / cols;
      if (c === to.col && r === to.row) {
        goal = s0;
        break;
      }
      for (let d = 0; d < 4; d++) {
        const nc = c + DIRS[d].col;
        const nr = r + DIRS[d].row;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || !open(nc, nr)) continue;
        const ns = (nr * cols + nc) * 4 + d;
        const next = cost + 1 + (d === heading ? 0 : TURN_COST);
        if (dist[ns] === -1 || next < dist[ns]) {
          dist[ns] = next;
          prev[ns] = s0;
          buckets[next % ring].push(ns);
          pending++;
        }
      }
    }
  }
  if (goal < 0) return null;
  const path: Tile[] = [];
  for (let s = goal; s >= 0; s = prev[s]) {
    const tile = s >> 2;
    path.push({ col: tile % cols, row: Math.floor(tile / cols) });
  }
  path.reverse();
  // Corners only: drop every tile that continues a straight run.
  return path.filter((p, i) => {
    if (i === 0 || i === path.length - 1) return true;
    const a = path[i - 1];
    const b = path[i + 1];
    return !(a.col === p.col && p.col === b.col) && !(a.row === p.row && p.row === b.row);
  });
}

const center = (t: Tile) => ({ x: (t.col + 0.5) * TILE_SIZE, y: (t.row + 0.5) * TILE_SIZE });

/** Routes are cached per map and end tiles: they change only when someone changes tile. */
const routeCache = new WeakMap<TileType[][], Map<string, Tile[] | null>>();

export function crewLines(office: {
  characters: ReadonlyMap<number, Character>;
  subagentMeta: ReadonlyMap<number, { parentAgentId: number; parentToolId: string }>;
  tileMap: TileType[][];
  blockedTiles: ReadonlySet<string>;
}): CrewLine[] {
  let cache = routeCache.get(office.tileMap);
  if (!cache) {
    cache = new Map();
    routeCache.set(office.tileMap, cache);
  }
  const out: CrewLine[] = [];
  for (const ch of office.characters.values()) {
    if (!ch.isSubagent || ch.matrixEffect === 'despawn') continue;
    const meta = office.subagentMeta.get(ch.id);
    const lead = meta ? office.characters.get(meta.parentAgentId) : undefined;
    if (!meta || !lead || lead.matrixEffect === 'despawn') continue;
    const from = { col: lead.tileCol, row: lead.tileRow };
    const to = { col: ch.tileCol, row: ch.tileRow };
    const key = `${from.col},${from.row}>${to.col},${to.row}:${office.blockedTiles.size}`;
    let route = cache.get(key);
    if (route === undefined) {
      route = aisleRoute(from, to, office.tileMap, office.blockedTiles);
      if (cache.size > 512) cache.clear();
      cache.set(key, route);
    }
    out.push({
      leadId: lead.id,
      helperId: ch.id,
      kind: meta.parentToolId.startsWith(WORKFLOW_PARENT_TOOL_ID_PREFIX) ? 'crew' : 'sub',
      // Not connected (a closed room): straight across, then down.
      points: (route ?? [from, { col: to.col, row: from.row }, to]).map(center),
    });
  }
  return out;
}
