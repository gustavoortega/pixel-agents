import { spriteWorldHeight } from '../../../../core/src/assets/artDensity.js';
import { pickDiversePalette } from '../../../../core/src/paletteUtils.js';
import type { ModelTier } from '../../../../core/src/provider.js';
import {
  AUTO_ON_FACING_DEPTH,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  COFFEE_COOLDOWN_SEC,
  COFFEE_MIN_STAY_SEC,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  GREETER_ID,
  GREETER_TILE_MARGIN,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  LOBBY_CAT_ID,
  LOUNGE_FURNITURE_TYPE,
  MAX_PET_ID_LENGTH,
  PET_HIT_HALF_WIDTH,
  PET_HIT_HEIGHT,
  SOFA_MAX_OCCUPANTS,
  WAITING_BUBBLE_DURATION_SEC,
} from '../../constants.js';
import { type FitAgent, LOBBY_ROOM } from '../camera.js';
import type { Companion, Tile } from '../flair/companion.js';
import {
  advanceTrail,
  companionTile,
  createCompanion,
  deskCompanionTile,
  tableCompanionTile,
  updateCompanion,
} from '../flair/companion.js';
import type { DeskPropKind } from '../flair/deskProps.js';
import {
  companionDeskTile,
  deskSlots,
  nearestTile,
  pcForSeat,
  propPlacements,
} from '../flair/deskProps.js';
import { type HeroCandidate, heroPerRoom } from '../flair/hero.js';
import { modelFlair } from '../flair/modelFlair.js';
import { FxEngine } from '../fx/fxEngine.js';
import { MoodWeather } from '../fx/moodWeather.js';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  getDeskTiles,
  getFurnitureTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer.js';
import { findPath, getWalkableTiles, isWalkable } from '../layout/tileMap.js';
import { monitorLook, monitorTick } from '../monitor.js';
import { seatedDrawOffsetPx } from '../seatDraw.js';
import { getPetCount, getPetName } from '../sprites/petSpriteData.js';
import { getLoadedCharacterCount } from '../sprites/spriteData.js';
import type { AgentRosterInfo, RosterEventInfo, TripwireAlarm } from '../toolUtils.js';
import type {
  Character,
  FurnitureInstance,
  OfficeLayout,
  Pet,
  PlacedFurniture,
  PlacedPet,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, Direction, IdlePose, PetState, TILE_SIZE, WorkStatus } from '../types.js';
import { createCharacter, updateCharacter } from './characters.js';
import { stepPose } from './idleLife.js';
import { advanceMatrixEffect, startMatrixEffect } from './matrixEffectState.js';
import { createPet, updatePet } from './petEntity.js';
import { anchorTile, closestFreeSeat } from './seatPlacement.js';

/** Internal helper: facing-tile coords for a seat. Returns null for invalid direction. */
function seatFacingOffset(direction: Direction): { dCol: number; dRow: number } {
  if (direction === Direction.RIGHT) return { dCol: 1, dRow: 0 };
  if (direction === Direction.LEFT) return { dCol: -1, dRow: 0 };
  if (direction === Direction.DOWN) return { dCol: 0, dRow: 1 };
  return { dCol: 0, dRow: -1 };
}

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  /** Seat by "col,row": what a sitting character's draw offset is read from. */
  private seatByTile: Map<string, Seat> = new Map();
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  characters: Map<number, Character> = new Map();
  /** Session titles by agent id. Keyed by id rather than stored on the character
   *  because a title can arrive before the (buffered) agentCreated does. */
  sessionTitles: Map<number, string> = new Map();
  /** Tripwire alarms by agent id. Keyed by id for the same reason as sessionTitles:
   *  an alarm can arrive before the (buffered) agentCreated does. */
  tripwires: Map<number, TripwireAlarm> = new Map();
  /** World px each agent's bubble/beacon/glyph rises above its default slot so it clears the plate
   *  and tripwire chip below it. Written by the overlay stack every frame, read by the renderer. */
  bubbleLift: Map<number, number> = new Map();
  /** Roster member data by agent id. Same reason as sessionTitles: it is sent at claim time,
   *  before the (buffered) agentCreated. */
  rosters: Map<number, AgentRosterInfo> = new Map();
  /** Newest transient roster event per agent, kept for later effects. No animation reads it yet. */
  rosterEvents: Map<number, RosterEventInfo & { level?: number; at: number }> = new Map();
  /** XP pops and level-ups in flight (budgeted) and the ambient mood weather (capped, not budgeted). */
  fx = new FxEngine();
  weather = new MoodWeather();
  /** Props on each seated agent's desk, from its level; rebuilt every update. */
  deskProps: Array<{ kind: DeskPropKind; col: number; row: number; zY: number }> = [];
  /** Share (0..1) of the current 5-hour block per Area label, for the thin bar on each room sign. */
  areaUsage: ReadonlyMap<string, number> = new Map();
  /** Model and tier by agent id, from `agentModel`. Keyed by id for the same reason as
   *  sessionTitles. A model the provider cannot place has no tier and no flair. */
  models: Map<number, { model: string; tier?: ModelTier }> = new Map();
  /** The follower of each agent whose tier brings a companion, by agent id. */
  companions: Map<number, Companion> = new Map();
  /** Every furniture footprint tile, background rows included (blockedTiles skips those). */
  furnitureTiles: Set<string>;
  /** Desk tiles with their desk's sort depth, and the electronics tiles: where a hero's companion sits. */
  private deskTiles: Map<string, number>;
  private electronicsTiles: Set<string>;
  /** Seat uid -> uid of the PC it owns, and each electronics item's footprint; set per layout load. */
  private pcBySeat: Map<string, string> = new Map();
  private electronicsById: Map<string, Tile[]> = new Map();
  /** Coffee table tiles with their sort depth: where the companion of someone on a sofa rests. */
  private tableTiles: Map<string, number> = new Map();
  pets: Pet[] = [];
  /** Accumulated time for furniture animation frame cycling */
  furnitureAnimTimer = 0;
  selectedAgentId: number | null = null;
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  private nextSubagentId = -1;

  /**
   * folderName → list of Area labels that workspace folder belongs to.
   * Populated by useExtensionMessages on `areaMappingsLoaded`. Consulted by
   * `findFreeSeat()` to bias new agents toward seats inside their folder's Area.
   */
  areaMappings: Record<string, string[]> = {};

  /**
   * The first-run consent greeter, deliberately NOT in `characters`.
   *
   * `characters` means "agents": everything that iterates it — seat
   * assignment, palette diversity, the wander FSM, hit-testing, the seat
   * payload the webview persists — is asking an agent question the greeter has
   * no answer to. Holding it here instead of tagging it with a flag makes
   * every one of those loops correct by default, rather than correct as long
   * as each remembers an `isGreeter` guard. It is drawn because
   * `getCharacters()` appends it, and that is the only place it joins the
   * others.
   */
  greeter: Character | null = null;

  /** World-space point the camera drifts to while the greeter is up
   *  (the bubble overlay recomputes it every frame: the combined center of the
   *  character and its speech bubble). An explicit cameraFollowId outranks it. */
  greeterCameraTarget: { x: number; y: number } | null = null;
  /** Latched by a manual pan during the ask: the user took the camera, so the
   *  overlay's per-frame updates stop re-centering. Reset on spawn/despawn. */
  private greeterCameraCancelled = false;

  setAreaMappings(mappings: Record<string, string[]>): void {
    this.areaMappings = mappings;
  }

  setAreaUsage(shares: ReadonlyMap<string, number>): void {
    this.areaUsage = shares;
  }

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.indexSeats();
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furnitureTiles = getFurnitureTiles(this.layout.furniture);
    this.deskTiles = getDeskTiles(this.layout.furniture);
    this.electronicsTiles = this.buildElectronicsTileSet();
    this.buildPcBySeat();
    this.tableTiles = this.buildTableTiles(this.layout);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    // Pets are built last because they need walkableTiles populated for spawn.
    this.rebuildPetsFromLayout(this.layout);
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters.
   *  @param shift Optional pixel shift to apply when grid expands left/up */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number }): void {
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.indexSeats();
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.furnitureTiles = getFurnitureTiles(layout.furniture);
    this.deskTiles = getDeskTiles(layout.furniture);
    this.electronicsTiles = this.buildElectronicsTileSet();
    this.buildPcBySeat();
    this.tableTiles = this.buildTableTiles(layout);
    this.rebuildFurnitureInstances();
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);

    // Shift character positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const ch of this.characters.values()) {
        ch.tileCol += shift.col;
        ch.tileRow += shift.row;
        ch.x += shift.col * TILE_SIZE;
        ch.y += shift.row * TILE_SIZE;
        // Clear path since tile coords changed
        ch.path = [];
        ch.moveProgress = 0;
      }
    }

    // Shift pet positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const pet of this.pets) {
        pet.tileCol += shift.col;
        pet.tileRow += shift.row;
        pet.x += shift.col * TILE_SIZE;
        pet.y += shift.row * TILE_SIZE;
        pet.path = [];
        pet.moveProgress = 0;
      }
    }

    // Reassign characters to new seats, preserving existing assignments when possible
    for (const seat of this.seats.values()) {
      seat.assigned = false;
    }
    // Seat ids and tiles may all be new: a coffee trip's sofa seat means nothing now.
    for (const ch of this.characters.values()) ch.trip = null;

    // First pass: try to keep characters at their existing seats
    for (const ch of this.characters.values()) {
      if (ch.seatId && this.seats.has(ch.seatId)) {
        const seat = this.seats.get(ch.seatId)!;
        if (!seat.assigned) {
          seat.assigned = true;
          // Snap character to seat position
          ch.tileCol = seat.seatCol;
          ch.tileRow = seat.seatRow;
          const cx = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
          const cy = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
          ch.x = cx;
          ch.y = cy;
          ch.dir = seat.facingDir;
          continue;
        }
      }
      ch.seatId = null; // will be reassigned below
    }

    // Second pass: assign remaining characters to free seats
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue;
      const seatId = this.findFreeSeat(ch.folderName);
      if (seatId) {
        this.seats.get(seatId)!.assigned = true;
        ch.seatId = seatId;
        const seat = this.seats.get(seatId)!;
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        ch.dir = seat.facingDir;
      }
    }

    // Relocate any characters that ended up outside bounds or on non-walkable tiles
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue; // seated characters are fine
      if (
        ch.tileCol < 0 ||
        ch.tileCol >= layout.cols ||
        ch.tileRow < 0 ||
        ch.tileRow >= layout.rows
      ) {
        this.relocateCharacterToWalkable(ch);
      }
    }

    // Relocate any pets that ended up outside bounds or on non-walkable tiles
    for (const pet of this.pets) {
      if (
        pet.tileCol < 0 ||
        pet.tileCol >= layout.cols ||
        pet.tileRow < 0 ||
        pet.tileRow >= layout.rows ||
        !isWalkable(pet.tileCol, pet.tileRow, this.tileMap, this.blockedTiles)
      ) {
        if (this.walkableTiles.length > 0) {
          const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
          pet.tileCol = spawn.col;
          pet.tileRow = spawn.row;
          pet.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
          pet.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
          pet.path = [];
          pet.moveProgress = 0;
          pet.state = PetState.IDLE;
          pet.frame = 0;
          pet.frameTimer = 0;
          pet.followTargetId = null;
        }
      }
    }

    // Reconcile pets against the layout roster (handles editor add/remove)
    this.rebuildPetsFromLayout(layout);
  }

  /** Move a character to a random walkable tile */
  private relocateCharacterToWalkable(ch: Character): void {
    if (this.walkableTiles.length === 0) return;
    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.path = [];
    ch.moveProgress = 0;
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  private indexSeats(): void {
    this.seatByTile = new Map();
    for (const seat of this.seats.values()) {
      this.seatByTile.set(`${seat.seatCol},${seat.seatRow}`, seat);
    }
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return null;
    return `${seat.seatCol},${seat.seatRow}`;
  }

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch);
    if (key) this.blockedTiles.delete(key);
    const result = fn();
    if (key) this.blockedTiles.add(key);
    return result;
  }

  /** The coffee table's tiles, mapped to the sort depth of its bottom edge. */
  private buildTableTiles(layout: OfficeLayout): Map<string, number> {
    const out = new Map<string, number>();
    for (const item of layout.furniture) {
      if (item.type !== LOUNGE_FURNITURE_TYPE) continue;
      const entry = getCatalogEntry(item.type);
      if (!entry) continue;
      const zY = item.row * TILE_SIZE + spriteWorldHeight(entry.sprite);
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++)
          out.set(`${item.col + dc},${item.row + dr}`, zY);
      }
    }
    return out;
  }

  /** Seat -> PC lookup, computed once per layout load. */
  private buildPcBySeat(): void {
    this.electronicsById = new Map();
    const pcs = [];
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.category !== 'electronics') continue;
      const tiles: Tile[] = [];
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          tiles.push({ col: item.col + dc, row: item.row + dr });
        }
      }
      this.electronicsById.set(item.uid, tiles);
      pcs.push({ uid: item.uid, orientation: entry.orientation, tiles });
    }
    this.pcBySeat = pcForSeat(
      [...this.seats.values()].map((s) => ({
        uid: s.uid,
        col: s.seatCol,
        row: s.seatRow,
        facing: s.facingDir,
      })),
      pcs,
    );
  }

  /** Collect every tile occupied by electronics furniture (PCs, monitors, etc.). */
  private buildElectronicsTileSet(): Set<string> {
    const out = new Set<string>();
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.category !== 'electronics') continue;
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          out.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }
    return out;
  }

  /** Find the area label assigned to a seat's tile, or null. Public for e2e
   *  observability (getAgentSeats hook reads a seated agent's area). */
  seatZone(uid: string): string | null {
    const seat = this.seats.get(uid);
    if (!seat) return null;
    const tiles = this.layout.areaTiles;
    if (!tiles || tiles.length === 0) return null;
    const idx = seat.seatRow * this.layout.cols + seat.seatCol;
    if (idx < 0 || idx >= tiles.length) return null;
    return tiles[idx] ?? null;
  }

  /**
   * Random-pick a seat from a candidate list, biased toward seats that face an
   * electronics tile. Returns null when the candidate list is empty.
   */
  private pickFromSeats(seatUids: string[]): string | null {
    if (seatUids.length === 0) return null;
    const pcSeats: string[] = [];
    const otherSeats: string[] = [];
    for (const uid of seatUids) {
      const seat = this.seats.get(uid);
      if (!seat) continue;
      if (this.pcBySeat.has(uid)) {
        pcSeats.push(uid);
      } else {
        otherSeats.push(uid);
      }
    }
    if (pcSeats.length > 0) return pcSeats[Math.floor(Math.random() * pcSeats.length)];
    if (otherSeats.length > 0) return otherSeats[Math.floor(Math.random() * otherSeats.length)];
    return null;
  }

  /**
   * 3-stage seat picker for top-level agents.
   *
   *   Stage 1: If `folderName` is given and `areaMappings[folderName]` lists
   *            Area labels, prefer free seats whose tile is labeled with one
   *            of those areas.
   *   Stage 2: Prefer free seats whose tile has NO area label (unzoned).
   *   Stage 3: Any free seat.
   *
   * Each stage routes through `pickFromSeats` for the PC-bias rule. Returns
   * null only when every seat is already occupied. Passing `undefined`
   * preserves pre-Areas single-stage behavior (skips Stage 1; Stage 2 picks
   * unzoned seats from a layout without `areaTiles`, which is every seat).
   */
  private findFreeSeat(folderName?: string): string | null {
    const freeSeats: string[] = [];
    const freeCouchSeats: string[] = [];
    for (const [uid, seat] of this.seats) {
      if (seat.assigned) continue;
      (seat.couch ? freeCouchSeats : freeSeats).push(uid);
    }
    // Couch cushions are for coffee: an agent only gets one when every desk seat is taken.
    if (freeSeats.length === 0) freeSeats.push(...freeCouchSeats);
    if (freeSeats.length === 0) return null;

    const areaLabels = folderName ? this.areaMappings[folderName] : undefined;

    // Stage 1 — in-area seats for the folder's mapped Area labels.
    if (areaLabels && areaLabels.length > 0) {
      const wanted = new Set(areaLabels);
      const inArea = freeSeats.filter((uid) => {
        const label = this.seatZone(uid);
        return label !== null && wanted.has(label);
      });
      const pick = this.pickFromSeats(inArea);
      if (pick) return pick;
    }

    // Stage 2 — unzoned seats (no area label, or layout has no areas at all).
    const unzoned = freeSeats.filter((uid) => this.seatZone(uid) === null);
    const pick2 = this.pickFromSeats(unzoned);
    if (pick2) return pick2;

    // Stage 3 — any free seat.
    return this.pickFromSeats(freeSeats);
  }

  /** Closest walkable tile to (col,row) not occupied by another character, or null. */
  private closestFreeWalkableTile(col: number, row: number): { col: number; row: number } | null {
    const occupied = new Set<string>();
    for (const ch of this.characters.values()) {
      occupied.add(`${ch.tileCol},${ch.tileRow}`);
    }
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    for (const tile of this.walkableTiles) {
      if (occupied.has(`${tile.col},${tile.row}`)) continue;
      const d = Math.abs(tile.col - col) + Math.abs(tile.row - row);
      if (d < bestDist) {
        best = tile;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * First 6 agents each get a unique skin (random order). Beyond 6, skins
   * repeat in balanced rounds with a random hue shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    // Count how many non-sub-agents use each base palette (0-5)
    const paletteCount = getLoadedCharacterCount();
    const counts = new Array(paletteCount).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      if (ch.palette < paletteCount) counts[ch.palette]++;
    }
    return pickDiversePalette(paletteCount, counts);
  }

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
    nearAgentId?: number,
    /** False for agents of unknown status (adopted or restored): they read as
     *  idle until the server says otherwise. Terminals we launched start working. */
    initialActive = true,
  ): void {
    if (this.characters.has(id)) return;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    // Try preferred seat first, then (for teammates) the seat closest to the
    // anchor agent, then any free seat. anchorTile resolves to the anchor's SEAT
    // (stable from creation) rather than its live tile, so a teammate placed while
    // the lead is still walking to its seat still clusters around the final seat.
    const anchor = nearAgentId !== undefined ? this.characters.get(nearAgentId) : undefined;
    const anchorAt = anchorTile(anchor, this.seats);
    let seatId: string | null = null;
    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!;
      // A saved seat is honoured only inside the folder's mapped Areas: ids and layouts move
      // between runs, and a seat in another room is how an agent ends up in the wrong one.
      // With no mapping the seat stands (manual placement).
      const wanted = folderName ? this.areaMappings[folderName] : undefined;
      const zone = this.seatZone(preferredSeatId);
      const inMappedArea =
        !wanted || wanted.length === 0 || (zone !== null && wanted.includes(zone));
      if (!seat.assigned && inMappedArea) {
        seatId = preferredSeatId;
      }
    }
    if (!seatId && anchorAt) {
      seatId = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    }
    if (!seatId) {
      seatId = this.findFreeSeat(folderName);
    }

    let ch: Character;
    if (seatId) {
      const seat = this.seats.get(seatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, seatId, seat, hueShift, initialActive);
    } else {
      // No seats — teammates spawn beside their anchor, others at a random walkable tile
      let spawn = anchorAt ? this.closestFreeWalkableTile(anchorAt.col, anchorAt.row) : null;
      if (!spawn) {
        spawn =
          this.walkableTiles.length > 0
            ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
            : { col: 1, row: 1 };
      }
      ch = createCharacter(id, palette, null, null, hueShift, initialActive);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }

    if (folderName) {
      ch.folderName = folderName;
    }
    if (!skipSpawnEffect) {
      startMatrixEffect(ch, 'spawn');
    }
    this.characters.set(id, ch);
  }

  // ── Greeter ───────────────────────────────────────────────────
  // The Intro is diegetic: a char_0 character stands near the office's
  // bottom-left corner and "speaks" the tour through a DOM bubble
  // (IntroBubble). It is not an agent — see the `greeter` field.

  /** Spawn the greeter near the office's bottom-left corner: target tile
   *  GREETER_TILE_MARGIN in from the left and bottom edges, falling
   *  back to the closest walkable tile when the target is a seat, furniture,
   *  a wall, or VOID (seat tiles are in blockedTiles, so closestFreeWalkableTile
   *  covers every one of those). Idempotent; a remount mid-despawn (StrictMode)
   *  revives it. */
  spawnGreeter(): void {
    this.greeterCameraCancelled = false;
    if (this.greeter) {
      if (this.greeter.matrixEffect === 'despawn') startMatrixEffect(this.greeter, 'spawn');
      return;
    }
    const spawn = this.closestFreeWalkableTile(
      GREETER_TILE_MARGIN,
      this.layout.rows - 1 - GREETER_TILE_MARGIN,
    );
    if (!spawn) return; // no walkable tile — IntroBubble falls back to a fixed panel
    const ch = createCharacter(GREETER_ID, 0, null, null, 0);
    ch.isGreeter = true;
    ch.state = CharacterState.IDLE;
    ch.isActive = false;
    ch.dir = Direction.DOWN;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    startMatrixEffect(ch, 'spawn');
    this.greeter = ch;
  }

  /** Start the greeter's despawn effect and release the greeter camera. The
   *  character is dropped once the effect finishes (see update()).
   *  Idempotent — every close path (answer, Escape, hooksStatus) funnels here. */
  despawnGreeter(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = false;
    if (!this.greeter || this.greeter.matrixEffect === 'despawn') return;
    startMatrixEffect(this.greeter, 'despawn');
  }

  /** Per-frame update from the bubble overlay; ignored once the user panned. */
  setGreeterCameraTarget(p: { x: number; y: number }): void {
    if (!this.greeterCameraCancelled) this.greeterCameraTarget = p;
  }

  /** Manual pan during the ask: stop re-centering until the next spawn. */
  cancelGreeterCamera(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = true;
  }

  removeAgent(id: number): void {
    this.sessionTitles.delete(id);
    this.tripwires.delete(id);
    this.rosters.delete(id);
    this.rosterEvents.delete(id);
    this.fx.forget(id);
    this.models.delete(id);
    this.companions.delete(id);
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.matrixEffect === 'despawn') return; // already despawning
    // Free seat and clear selection immediately
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
    // Start despawn animation instead of immediate delete
    startMatrixEffect(ch, 'despawn');
    ch.bubbleType = null;
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid;
    }
    return null;
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch) return;
    // Unassign old seat
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId);
      if (old) old.assigned = false;
    }
    // Assign new seat
    const seat = this.seats.get(seatId);
    if (!seat || seat.assigned) return;
    seat.assigned = true;
    ch.seatId = seatId;
    // Pathfind to new seat (unblock own seat tile for this query)
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat or no path — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /**
   * Move a just-linked teammate to the free seat closest to its lead, so teams
   * cluster. Only moves when that seat is strictly closer than the teammate's
   * current one — a teammate created as a plain external agent (seated by an
   * arbitrary findFreeSeat) and tagged as a teammate only after tag discovery
   * would otherwise keep its arbitrary seat, unlike an inline teammate seated
   * next to the lead at creation.
   */
  private reseatNextToLead(teammateId: number, leadId: number): void {
    const teammate = this.characters.get(teammateId);
    const lead = this.characters.get(leadId);
    if (!teammate || !lead) return;
    const anchorAt = anchorTile(lead, this.seats);
    if (!anchorAt) return;
    const target = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    if (!target || target === teammate.seatId) return;
    const targetSeat = this.seats.get(target)!;
    const targetDist =
      Math.abs(targetSeat.seatCol - anchorAt.col) + Math.abs(targetSeat.seatRow - anchorAt.row);
    const currentSeat = teammate.seatId ? this.seats.get(teammate.seatId) : undefined;
    const currentDist = currentSeat
      ? Math.abs(currentSeat.seatCol - anchorAt.col) + Math.abs(currentSeat.seatRow - anchorAt.row)
      : Infinity;
    if (targetDist < currentDist) {
      this.reassignSeat(teammateId, target);
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.seatId) return;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent) return false;
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tile (blocked for others but not self)
      const key = this.ownSeatKey(ch);
      if (!key || key !== `${col},${row}`) return false;
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles),
    );
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** Area label of a tile, LOBBY_ROOM outside every Area. */
  private roomOfTile(col: number, row: number): string {
    return this.layout.areaTiles?.[row * this.layout.cols + col] ?? LOBBY_ROOM;
  }

  /**
   * Where a helper goes: the nearest free desk seat in its parent's room (helpers type at a desk),
   * else a floor tile at least two tiles from the parent and outside the parent's column, so it
   * never reads as a clone standing in front of or behind its parent. Null seat and tile only
   * when the map has no walkable tile at all.
   */
  private helperPlacement(parentCh: Character | undefined): {
    seatId: string | null;
    tile: { col: number; row: number };
  } {
    const pc = parentCh ? parentCh.tileCol : 0;
    const pr = parentCh ? parentCh.tileRow : 0;
    // The room of the parent's seat, not of where it stands: a parent on a coffee walk still has a home room.
    const parentSeat = parentCh?.seatId ? this.seats.get(parentCh.seatId) : undefined;
    const homeRoom = parentSeat
      ? this.roomOfTile(parentSeat.seatCol, parentSeat.seatRow)
      : this.roomOfTile(pc, pr);
    const dist = (col: number, row: number): number => Math.abs(col - pc) + Math.abs(row - pr);

    let bestSeat: string | null = null;
    let bestD = Infinity;
    for (const [uid, seat] of this.seats) {
      if (seat.assigned || seat.couch) continue;
      if (this.roomOfTile(seat.seatCol, seat.seatRow) !== homeRoom) continue;
      const d = dist(seat.seatCol, seat.seatRow);
      if (d < bestD) {
        bestD = d;
        bestSeat = uid;
      }
    }
    if (bestSeat) {
      const seat = this.seats.get(bestSeat)!;
      return { seatId: bestSeat, tile: { col: seat.seatCol, row: seat.seatRow } };
    }

    const occupied = new Set<string>();
    for (const ch of this.characters.values()) occupied.add(`${ch.tileCol},${ch.tileRow}`);
    let best: { col: number; row: number } | null = null;
    let bestRank = Infinity;
    for (const t of this.walkableTiles) {
      if (occupied.has(`${t.col},${t.row}`)) continue;
      if (Math.max(Math.abs(t.col - pc), Math.abs(t.row - pr)) < 2) continue;
      if (t.col === pc) continue;
      // Same room first, then nearest.
      const rank = (this.roomOfTile(t.col, t.row) === homeRoom ? 0 : 10_000) + dist(t.col, t.row);
      if (rank < bestRank) {
        bestRank = rank;
        best = t;
      }
    }
    return { seatId: null, tile: best ?? this.walkableTiles[0] ?? { col: pc, row: pr } };
  }

  /**
   * Create a helper (sub-agent) character. It keeps its parent's face and hair shape; the
   * renderer washes the rest to gray (the helper look), so it never reads as a clone.
   */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`;
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!;

    const id = this.nextSubagentId--;
    const parentCh = this.characters.get(parentAgentId);
    const palette = parentCh ? parentCh.palette : 0;
    const hueShift = parentCh ? parentCh.hueShift : 0;

    const { seatId, tile: spawn } = this.helperPlacement(parentCh);
    const seat = seatId ? this.seats.get(seatId)! : null;
    if (seat) seat.assigned = true;

    const ch = createCharacter(id, palette, seatId, seat, hueShift);
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    if (seat) ch.dir = seat.facingDir;
    else if (parentCh) ch.dir = parentCh.dir;
    ch.isSubagent = true;
    ch.parentAgentId = parentAgentId;
    startMatrixEffect(ch, 'spawn');
    this.characters.set(id, ch);

    this.subagentIdMap.set(key, id);
    this.subagentMeta.set(id, { parentAgentId, parentToolId });
    return id;
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`;
    const id = this.subagentIdMap.get(key);
    if (id === undefined) return;

    const ch = this.characters.get(id);
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        // Already despawning — just clean up maps
        this.subagentIdMap.delete(key);
        this.subagentMeta.delete(id);
        return;
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat) seat.assigned = false;
      }
      // Start despawn animation — keep character in map for rendering
      startMatrixEffect(ch, 'despawn');
      ch.bubbleType = null;
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key);
    this.subagentMeta.delete(id);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toRemove: string[] = [];
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id);
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id);
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            // Already despawning — just clean up maps
            this.subagentMeta.delete(id);
            toRemove.push(key);
            continue;
          }
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId);
            if (seat) seat.assigned = false;
          }
          // Start despawn animation
          startMatrixEffect(ch, 'despawn');
          ch.bubbleType = null;
        }
        this.subagentMeta.delete(id);
        if (this.selectedAgentId === id) this.selectedAgentId = null;
        if (this.cameraFollowId === id) this.cameraFollowId = null;
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key);
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null;
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.isActive = active;
      // Not working reads as idle until a waiting status says otherwise (applyAgentStatus sends
      // showWaitingBubble right after): the pose is decided from the settled status, not this hop.
      ch.agentStatus = active ? WorkStatus.ACTIVE : WorkStatus.IDLE;
      if (!active) {
        // Sentinel -1: signals turn just ended, skip next seat rest timer.
        // Prevents the WALK handler from setting a 2-4 min rest on arrival.
        ch.seatTimer = -1;
        ch.path = [];
        ch.moveProgress = 0;
      }
      this.rebuildFurnitureInstances();
    }
  }

  /**
   * Uids of the PCs that are lit: the one PC each seat owns, while the agent seated there is
   * working (status truth). A PC with nobody at it, or an idle agent, stays off.
   */
  private litPcUids(): Set<string> {
    const lit = new Set<string>();
    for (const ch of this.characters.values()) {
      if (ch.agentStatus !== WorkStatus.ACTIVE || !ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (!seat || seat.seatCol !== ch.tileCol || seat.seatRow !== ch.tileRow) continue;
      const pc = this.pcBySeat.get(ch.seatId);
      if (pc) lit.add(pc);
    }
    return lit;
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    const litPcs = this.litPcUids();

    if (litPcs.size === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture);
      return;
    }

    // Build modified furniture list with auto-state and animation applied
    const tick = monitorTick(this.furnitureAnimTimer * 1000);
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type);
      if (!entry) return item;
      if (!litPcs.has(item.uid)) return item;
      const onType = getOnStateType(item.type);
      if (onType === item.type) return item;
      // The on-state may have animation frames: pick the one this tick shows.
      const frames = getAnimationFrames(onType);
      if (frames && frames.length > 1) {
        return { ...item, type: frames[monitorLook(true, tick).frame % frames.length] };
      }
      return { ...item, type: onType };
    });

    this.furniture = layoutToFurnitureInstances(modifiedFurniture);
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.currentTool = tool;
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'permission';
      ch.bubbleTimer = 0;
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
  }

  showWaitingBubble(id: number, awaitingInput = false): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.agentStatus = WorkStatus.WAITING;
      ch.bubbleType = 'waiting';
      ch.waitingAwaitingInput = awaitingInput;
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
    }
  }

  /** Drop a waiting bubble (permission bubbles are not this method's to clear). */
  clearWaitingBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'waiting') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id);
    if (!ch || !ch.bubbleType) return;
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
    }
  }

  // ── Pets ──────────────────────────────────────────────────────

  /**
   * Add a pet to the live runtime. Spawns at a uniformly-random walkable tile.
   * Mirror in `this.layout.pets` so debounced saveLayout serialises the roster.
   * Bounds-checks petType against the loaded sprite count to defend against stale layouts.
   */
  addPet(placedPet: PlacedPet): void {
    // Defensive guards (upstream 5e6c0a0)
    if (
      typeof placedPet.id !== 'string' ||
      placedPet.id.length === 0 ||
      placedPet.id.length > MAX_PET_ID_LENGTH
    ) {
      return;
    }
    if (
      !Number.isInteger(placedPet.petType) ||
      placedPet.petType < 0 ||
      placedPet.petType >= getPetCount()
    ) {
      return;
    }
    if (this.pets.some((p) => p.id === placedPet.id)) return; // de-dupe
    if (this.walkableTiles.length === 0) return; // no spawn space — silently drop

    // The lobby cat lives in the lobby; any other pet lives in the room it spawns in.
    const lobby = this.walkableTiles.filter((t) => this.roomOfTile(t.col, t.row) === LOBBY_ROOM);
    const pool = placedPet.id === LOBBY_CAT_ID && lobby.length > 0 ? lobby : this.walkableTiles;
    const spawn = pool[Math.floor(Math.random() * pool.length)];
    const pet = createPet(placedPet.id, placedPet.petType, spawn.col, spawn.row);
    pet.homeRoom = this.roomOfTile(spawn.col, spawn.row);
    pet.name = getPetName(placedPet.petType);
    this.pets.push(pet);
    this.syncLayoutPets();
  }

  /** Remove a pet by id. Idempotent. */
  removePet(id: string): void {
    const before = this.pets.length;
    this.pets = this.pets.filter((p) => p.id !== id);
    if (this.pets.length !== before) {
      this.syncLayoutPets();
    }
  }

  /** Shallow snapshot for external consumers (renderer, hooks). */
  getPets(): Pet[] {
    return this.pets.slice();
  }

  /** Unique petType values currently placed. Used by the Pets toolbar to mark active rows. */
  getActivePetTypes(): number[] {
    const seen = new Set<number>();
    for (const p of this.pets) seen.add(p.petType);
    return Array.from(seen);
  }

  /**
   * Hit-test pets at a pixel world position. Sorts back-to-front (largest y wins on tie)
   * so the visually-frontmost pet receives the click.
   * Returns the pet id or null.
   */
  getPetAt(worldX: number, worldY: number): string | null {
    const ordered = this.pets.slice().sort((a, b) => b.y - a.y);
    for (const pet of ordered) {
      const left = pet.x - PET_HIT_HALF_WIDTH;
      const right = pet.x + PET_HIT_HALF_WIDTH;
      const top = pet.y - PET_HIT_HEIGHT;
      const bottom = pet.y;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return pet.id;
      }
    }
    return null;
  }

  /** Show the heart bubble on a pet for WAITING_BUBBLE_DURATION_SEC. */
  showPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet) return;
    pet.bubbleType = 'heart';
    pet.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
  }

  /** Dismiss the heart bubble on click; collapses timer to a fast fade. */
  dismissPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet || !pet.bubbleType) return;
    pet.bubbleTimer = Math.min(pet.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
  }

  /**
   * Reconcile `this.pets` to match the layout's placed-pet roster.
   * - Pets in layout but not in runtime → spawn via addPet().
   * - Pets in runtime but not in layout → remove.
   * - Pets in both → keep existing runtime state (position, FSM).
   *
   * Called from constructor and rebuildFromLayout. Always runs AFTER walkableTiles
   * is populated.
   */
  private rebuildPetsFromLayout(layout: OfficeLayout): void {
    const placed = layout.pets ?? [];
    const placedIds = new Set(placed.map((p) => p.id));

    // 1. Remove pets no longer in layout
    this.pets = this.pets.filter((p) => placedIds.has(p.id));

    // 2. Add pets that exist in layout but not in runtime
    const existingIds = new Set(this.pets.map((p) => p.id));
    for (const p of placed) {
      if (existingIds.has(p.id)) continue;
      this.addPet(p); // pushes onto this.pets, calls syncLayoutPets()
    }
    // syncLayoutPets() inside addPet keeps this.layout.pets coherent; one final
    // sync handles the removal-only branch where addPet was never called.
    this.syncLayoutPets();
  }

  /**
   * Re-export the current pet roster into `this.layout.pets`. Called only from
   * mutating methods (addPet / removePet / rebuildPetsFromLayout) — NEVER from
   * getLayout(), which runs on every render frame.
   */
  private syncLayoutPets(): void {
    this.layout.pets = this.pets.map((p) => ({ id: p.id, petType: p.petType }));
  }

  setTeamInfo(
    id: number,
    teamName?: string,
    agentName?: string,
    isTeamLead?: boolean,
    leadAgentId?: number,
    teamUsesTmux?: boolean,
  ): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    const wasUnlinked = ch.leadAgentId === undefined;
    ch.teamName = teamName;
    ch.agentName = agentName;
    ch.isTeamLead = isTeamLead;
    ch.leadAgentId = leadAgentId;
    if (teamUsesTmux !== undefined) {
      ch.teamUsesTmux = teamUsesTmux;
    }
    // A teammate is not a headless agent: clicking it focuses its lead's terminal.
    // Adopted sessions are marked headless at creation and only later discovered
    // to be teammates, so drop the mark once the link lands.
    if (leadAgentId !== undefined) {
      ch.isHeadless = false;
    }
    // A teammate discovered only after its plain external session was adopted is
    // linked here, not at creation, so it never went through the seat-next-to-lead
    // path addAgent runs for inline teammates. Cluster it now, once, on first link.
    if (wasUnlinked && leadAgentId !== undefined && !isTeamLead) {
      this.reseatNextToLead(id, leadAgentId);
    }
  }

  /** Mark an agent as headless (adopted, no terminal to focus). */
  setHeadless(id: number, headless: boolean): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.isHeadless = headless;
  }

  setAgentContext(id: number, contextTokens: number, maxContextTokens: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.contextTokens = contextTokens;
    ch.maxContextTokens = maxContextTokens;
  }

  /** Undefined clears the title: the label falls back to the folder. */
  setSessionTitle(id: number, title: string | undefined): void {
    if (title) this.sessionTitles.set(id, title);
    else this.sessionTitles.delete(id);
  }

  setRoster(id: number, roster: AgentRosterInfo): void {
    this.rosters.set(id, roster);
  }

  setRosterEvent(id: number, event: RosterEventInfo & { level?: number }, now: number): void {
    this.rosterEvents.set(id, { ...event, at: now });
    this.fx.onRosterEvent(id, event, now);
  }

  /** No model clears it: the character goes back to its plain look. */
  setAgentModel(id: number, model: string | undefined, tier: ModelTier | undefined): void {
    if (model) this.models.set(id, { model, tier });
    else this.models.delete(id);
  }

  /** Undefined clears the alarm. */
  setTripwire(id: number, alarm: TripwireAlarm | undefined): void {
    if (alarm) this.tripwires.set(id, alarm);
    else this.tripwires.delete(id);
  }

  update(dt: number): void {
    // Furniture animation cycling
    const prevFrame = monitorTick(this.furnitureAnimTimer * 1000);
    this.furnitureAnimTimer += dt;
    const newFrame = monitorTick(this.furnitureAnimTimer * 1000);
    if (newFrame !== prevFrame) {
      this.rebuildFurnitureInstances();
    }

    // The greeter materializes and dematerializes like anyone else, but runs
    // no FSM — it stands where it spawned for as long as the ask is up.
    if (this.greeter && advanceMatrixEffect(this.greeter, dt) === 'despawned') {
      this.greeter = null;
    }

    const toDelete: number[] = [];
    for (const ch of this.characters.values()) {
      const effect = advanceMatrixEffect(ch, dt);
      if (effect !== 'none') {
        if (effect === 'despawned') toDelete.push(ch.id);
        continue; // skip normal FSM while the effect is (or just was) active
      }

      // Idle life: decide the pose, then let a coffee trip hold the character on its sofa.
      let held = false;
      if (!ch.isSubagent) {
        stepPose(ch, dt, {
          coffeeActive: () => ch.trip !== null,
          sofaFree: () => this.freeSofaSlot(ch) !== null,
          startCoffee: () => this.startCoffeeTrip(ch),
        });
        held = this.stepCoffeeTrip(ch, dt);
      } else {
        // A helper at its desk reads or naps when idle like anyone, but never goes for coffee.
        stepPose(ch, dt, {
          coffeeActive: () => false,
          sofaFree: () => false,
          startCoffee: () => false,
        });
      }

      if (!held) {
        // Temporarily unblock own seat so character can pathfind to it
        this.withOwnSeatUnblocked(ch, () =>
          updateCharacter(
            ch,
            dt,
            this.walkableTiles,
            this.seats,
            this.tileMap,
            this.blockedTiles,
            this.layout.areaTiles,
            this.layout.cols,
          ),
        );
        if (!ch.isSubagent) this.arriveAtSofa(ch);
      }
      // A sitting character is drawn as low as its seat asks; standing resets it, so nothing sticks.
      ch.drawSink =
        ch.state === CharacterState.TYPE
          ? (this.seatByTile.get(`${ch.tileCol},${ch.tileRow}`)?.sink ?? 0)
          : 0;

      // Tick bubble timer for waiting bubbles
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }
    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id);
    }

    this.updateCompanions(dt);
    this.updateDeskProps();
    const now = Date.now();
    this.fx.tick(now);
    this.weather.update(new Map([...this.rosters].map(([id, r]) => [id, r.mood])), now);

    // ── Pet FSM ────────────────────────────────────────────────
    for (const pet of this.pets) {
      updatePet(
        pet,
        dt,
        this.walkableTiles,
        this.characters,
        this.tileMap,
        this.blockedTiles,
        (c, r) => this.roomOfTile(c, r),
      );

      // Tick heart bubble timer (mirrors character waiting-bubble pattern)
      if (pet.bubbleType) {
        pet.bubbleTimer -= dt;
        if (pet.bubbleTimer <= 0) {
          pet.bubbleType = null;
          pet.bubbleTimer = 0;
        }
      }
    }
  }

  // ── Coffee trips ──────────────────────────────────────────────
  // An idle coffee drinker walks to a sofa, sits with a mug, and walks back when work resumes.
  // Cushions and chairs stay collision cells: the agent paths to the cell beside its seat and
  // the sit is one more step onto the cushion.

  /** Characters currently on a coffee trip: the sofas' occupants. */
  private sofaOccupants(): number {
    let n = 0;
    for (const c of this.characters.values()) if (c.trip) n++;
    return n;
  }

  /** The best free couch seat for `ch` and the cell it is entered from, or null when the sofas are full or unreachable. */
  private freeSofaSlot(
    ch: Character,
  ): { sofaSeatId: string; approach: { col: number; row: number } } | null {
    if (this.sofaOccupants() >= SOFA_MAX_OCCUPANTS) return null;
    const taken = new Set<string>();
    for (const c of this.characters.values()) if (c.trip) taken.add(c.trip.sofaSeatId);
    let best: { sofaSeatId: string; approach: { col: number; row: number }; len: number } | null =
      null;
    for (const [uid, seat] of this.seats) {
      if (!seat.couch || seat.assigned || taken.has(uid)) continue;
      // In front of the seat first (where the table is), then the sides, then behind.
      const f = seatFacingOffset(seat.facingDir);
      const around = [
        { col: seat.seatCol + f.dCol, row: seat.seatRow + f.dRow },
        { col: seat.seatCol + f.dRow, row: seat.seatRow + f.dCol },
        { col: seat.seatCol - f.dRow, row: seat.seatRow - f.dCol },
        { col: seat.seatCol - f.dCol, row: seat.seatRow - f.dRow },
      ];
      for (const cell of around) {
        if (!isWalkable(cell.col, cell.row, this.tileMap, this.blockedTiles)) continue;
        const atCell = ch.tileCol === cell.col && ch.tileRow === cell.row;
        const path = atCell
          ? []
          : this.withOwnSeatUnblocked(ch, () =>
              findPath(ch.tileCol, ch.tileRow, cell.col, cell.row, this.tileMap, this.blockedTiles),
            );
        if (!atCell && path.length === 0) continue;
        if (!best || path.length < best.len) {
          best = { sofaSeatId: uid, approach: cell, len: path.length };
        }
        break;
      }
    }
    return best ? { sofaSeatId: best.sofaSeatId, approach: best.approach } : null;
  }

  /** Send `ch` out for coffee. False when no sofa slot is reachable. */
  private startCoffeeTrip(ch: Character): boolean {
    const slot = this.freeSofaSlot(ch);
    if (!slot) return false;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(
        ch.tileCol,
        ch.tileRow,
        slot.approach.col,
        slot.approach.row,
        this.tileMap,
        this.blockedTiles,
      ),
    );
    ch.trip = { stage: 'out', sofaSeatId: slot.sofaSeatId, approach: slot.approach, staySec: 0 };
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = path.length > 0 ? CharacterState.WALK : CharacterState.IDLE;
    ch.frame = 0;
    ch.frameTimer = 0;
    ch.pose = IdlePose.COFFEE;
    ch.poseClockSec = 0;
    return true;
  }

  /** The pose an agent falls back to when a trip ends, from its status alone. */
  private poseForStatus(ch: Character): IdlePose {
    if (ch.agentStatus === WorkStatus.ACTIVE) return IdlePose.TYPING;
    return ch.agentStatus === WorkStatus.WAITING ? IdlePose.WAIT_BUBBLE : IdlePose.READING;
  }

  /**
   * Walk `ch` from wherever it is back to its own desk seat. A walker caught between two tiles
   * turns around where it stands: its tile becomes the one it was heading to and the first step is
   * back to the one it left, so the sprite never jumps.
   */
  private sendBackToDesk(ch: Character): void {
    const seat = ch.seatId ? this.seats.get(ch.seatId) : undefined;
    if (!seat) return;
    const turning = ch.state === CharacterState.WALK && ch.path.length > 0 && ch.moveProgress > 0;
    const from = { col: ch.tileCol, row: ch.tileRow };
    if (turning) {
      const heading = ch.path[0];
      ch.tileCol = heading.col;
      ch.tileRow = heading.row;
    }
    const start = turning ? from : { col: ch.tileCol, row: ch.tileRow };
    const rest = this.withOwnSeatUnblocked(ch, () =>
      findPath(start.col, start.row, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    const path = turning ? [start, ...rest] : rest;
    if (path.length === 0) {
      // Already there, or boxed in: put it back rather than strand it on the sofa.
      ch.tileCol = seat.seatCol;
      ch.tileRow = seat.seatRow;
      ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
      ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.path = [];
      return;
    }
    ch.path = path;
    ch.moveProgress = turning ? 1 - ch.moveProgress : 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
  }

  /** End a trip (the way back is a plain walk to the desk) and start the cooldown. */
  private endCoffeeTrip(ch: Character): void {
    ch.trip = null;
    ch.coffeeCooldownSec = COFFEE_COOLDOWN_SEC;
    ch.pose = this.poseForStatus(ch);
    ch.poseClockSec = 0;
    ch.poseStatus = ch.agentStatus;
    this.sendBackToDesk(ch);
  }

  /**
   * Before the walk/sit FSM: work resuming (or the turn ending) mid-walk turns the agent around
   * where it stands, and a sitter leaves once it has stayed COFFEE_MIN_STAY_SEC. True while the
   * character sits on the sofa, so the FSM leaves it there.
   */
  private stepCoffeeTrip(ch: Character, dt: number): boolean {
    const trip = ch.trip;
    if (!trip) return false;
    if (trip.stage === 'out') {
      if (ch.agentStatus !== WorkStatus.IDLE) this.endCoffeeTrip(ch);
      return false;
    }
    trip.staySec += dt;
    if (ch.agentStatus !== WorkStatus.IDLE && trip.staySec >= COFFEE_MIN_STAY_SEC) {
      this.endCoffeeTrip(ch);
      return false;
    }
    return true;
  }

  /** After the FSM: a walker that reached the cell beside its sofa seat takes the one step onto it. */
  private arriveAtSofa(ch: Character): void {
    const trip = ch.trip;
    if (!trip || trip.stage !== 'out') return;
    if (ch.state === CharacterState.WALK || ch.path.length > 0) return;
    if (ch.tileCol !== trip.approach.col || ch.tileRow !== trip.approach.row) return;
    const seat = this.seats.get(trip.sofaSeatId);
    if (!seat) {
      this.endCoffeeTrip(ch);
      return;
    }
    ch.tileCol = seat.seatCol;
    ch.tileRow = seat.seatRow;
    ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
    ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
    ch.dir = seat.facingDir;
    ch.state = CharacterState.TYPE;
    ch.frame = 0;
    ch.frameTimer = 0;
    ch.poseClockSec = 0;
    trip.stage = 'sat';
  }

  /** What the camera fit sees: who is working where, and where everyone stands. */
  fitAgents(): FitAgent[] {
    const tiles = this.layout.areaTiles;
    const out: FitAgent[] = [];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent || ch.matrixEffect === 'despawn') continue;
      const tileRoom = tiles?.[ch.tileRow * this.layout.cols + ch.tileCol] ?? LOBBY_ROOM;
      out.push({
        working: ch.agentStatus !== WorkStatus.IDLE,
        room: this.roomOf(ch) ?? LOBBY_ROOM,
        tileRoom,
      });
    }
    return out;
  }

  /**
   * Level props on each seated agent's desk. Slots exclude the monitor and the companion's cell
   * (every agent's, so a prop never lands where another agent's companion would sit).
   */
  private updateDeskProps(): void {
    const seated: Array<{ id: number; pc: Tile; across: Tile; level: number }> = [];
    for (const id of [...this.characters.keys()].sort((a, b) => a - b)) {
      const ch = this.characters.get(id)!;
      const level = this.rosters.get(id)?.level ?? 0;
      const seat = ch.seatId ? this.seats.get(ch.seatId) : undefined;
      if (ch.isSubagent || !seat || ch.state === CharacterState.WALK) continue;
      if (seat.seatCol !== ch.tileCol || seat.seatRow !== ch.tileRow) continue;
      const pcUid = this.pcBySeat.get(seat.uid);
      const pc = pcUid
        ? nearestTile(
            { col: seat.seatCol, row: seat.seatRow },
            this.electronicsById.get(pcUid) ?? [],
          )
        : null;
      if (!pc) continue;
      const { dCol } = seatFacingOffset(seat.facingDir);
      seated.push({ id, pc, across: dCol === 0 ? { col: 1, row: 0 } : { col: 0, row: 1 }, level });
    }
    const blocked = new Set<string>();
    for (const s of seated) {
      const c = companionDeskTile(s.pc);
      blocked.add(`${c.col},${c.row}`);
    }
    const out: typeof this.deskProps = [];
    for (const s of seated) {
      if (s.level < 5) continue;
      const slots = deskSlots({
        pc: s.pc,
        across: s.across,
        deskTiles: this.deskTiles,
        electronicsTiles: this.electronicsTiles,
        blocked,
      });
      for (const p of propPlacements(s.level, slots)) {
        const key = `${p.tile.col},${p.tile.row}`;
        blocked.add(key);
        out.push({
          kind: p.kind,
          col: p.tile.col,
          row: p.tile.row,
          zY: this.deskTiles.get(key) ?? 0,
        });
      }
    }
    this.deskProps = out;
  }

  /** Area label of the room an agent sits in (its seat, else the tile it stands on); null outside every area. */
  roomOf(ch: Character): string | null {
    const tiles = this.layout.areaTiles;
    if (!tiles || tiles.length === 0) return null;
    const seat = ch.seatId ? this.seats.get(ch.seatId) : undefined;
    const col = seat ? seat.seatCol : ch.tileCol;
    const row = seat ? seat.seatRow : ch.tileRow;
    return tiles[row * this.layout.cols + col] ?? null;
  }

  /**
   * Place and animate the companion of each room's hero. One pass in id order, claiming
   * each tile as it is assigned, so two companions can never share one.
   * A tile is free when it is walkable, holds no furniture, no character and
   * no other companion. A standing agent counts as seated: its companion takes
   * left, right or below of wherever it stands. A hero seated at its desk puts its
   * companion on the desk instead, one tile right of the monitor it faces.
   */
  private updateCompanions(dt: number): void {
    const occupied = new Set<string>();
    for (const ch of this.characters.values()) occupied.add(`${ch.tileCol},${ch.tileRow}`);
    const taken = new Set<string>();
    const isFree = (t: Tile): boolean => {
      const key = `${t.col},${t.row}`;
      return (
        isWalkable(t.col, t.row, this.tileMap, this.blockedTiles) &&
        !this.furnitureTiles.has(key) &&
        !occupied.has(key) &&
        !taken.has(key)
      );
    };

    const ids = Array.from(this.characters.keys()).sort((a, b) => a - b);
    const candidates: HeroCandidate[] = [];
    for (const id of ids) {
      const ch = this.characters.get(id)!;
      if (ch.isSubagent || ch.matrixEffect) continue;
      candidates.push({
        id,
        room: this.roomOf(ch),
        level: this.rosters.get(id)?.level ?? 0,
        activeAt: this.rosterEvents.get(id)?.at ?? 0,
      });
    }
    const heroes = heroPerRoom(candidates);

    for (const id of ids) {
      const ch = this.characters.get(id)!;
      const kind = heroes.has(id) ? modelFlair(this.models.get(id)?.tier).companion : undefined;
      if (!kind) {
        this.companions.delete(id);
        continue;
      }
      const agentTile = { col: ch.tileCol, row: ch.tileRow };
      let c = this.companions.get(id);
      if (!c || c.kind !== kind) {
        c = createCompanion(id, kind, agentTile);
        this.companions.set(id, c);
      }
      const moving = ch.state === CharacterState.WALK;
      c.trail = moving ? advanceTrail(c.trail, c.lastAgentTile, agentTile) : [];
      c.lastAgentTile = agentTile;
      const seat = !moving && ch.seatId ? this.seats.get(ch.seatId) : undefined;
      const atSeat = !!seat && seat.seatCol === agentTile.col && seat.seatRow === agentTile.row;
      let target: Tile | null = null;
      c.deskZY = null;
      // The lounge's hero on a sofa keeps its companion on the coffee table in front of it.
      const sofa =
        !moving && ch.trip?.stage === 'sat' ? this.seats.get(ch.trip.sofaSeatId) : undefined;
      if (sofa) {
        const { dCol, dRow } = seatFacingOffset(sofa.facingDir);
        target = tableCompanionTile({
          seat: { col: sofa.seatCol, row: sofa.seatRow },
          facing: { col: dCol, row: dRow },
          depth: AUTO_ON_FACING_DEPTH,
          tableTiles: this.tableTiles,
          isTaken: (t) => taken.has(`${t.col},${t.row}`),
        });
        if (target) c.deskZY = this.tableTiles.get(`${target.col},${target.row}`) ?? null;
      } else if (seat && atSeat) {
        const { dCol, dRow } = seatFacingOffset(seat.facingDir);
        target = deskCompanionTile({
          seat: agentTile,
          facing: { col: dCol, row: dRow },
          depth: AUTO_ON_FACING_DEPTH,
          electronicsTiles: this.electronicsTiles,
          deskTiles: this.deskTiles,
          isTaken: (t) => taken.has(`${t.col},${t.row}`),
        });
        if (target) c.deskZY = this.deskTiles.get(`${target.col},${target.row}`) ?? null;
      }
      target ??= companionTile({ moving, agentTile, trail: c.trail, isFree });
      if (target) taken.add(`${target.col},${target.row}`);
      updateCompanion(c, target, ch.tileCol, dt);
    }
    // Agents that left the office take their companion with them
    for (const id of this.companions.keys()) {
      if (!this.characters.has(id)) this.companions.delete(id);
    }
  }

  /** The `saveAgentSeats` payload: palette, hue and seat for every agent worth
   *  restoring. Sub-agents are excluded because they are derived state the
   *  runtime re-materializes, and the greeter never reaches here at all —
   *  it is not in `characters`. */
  getPersistableSeats(): Record<
    number,
    { palette: number; hueShift: number; seatId: string | null }
  > {
    const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
    }
    return seats;
  }

  /** Everything the renderer draws: the agents plus, while the first-run ask
   *  is up, the consent greeter. This is the ONE place the greeter joins the
   *  agents — every other consumer reads `characters` and gets agents only. */
  getCharacters(): Character[] {
    const chars = Array.from(this.characters.values());
    if (this.greeter) chars.push(this.greeter);
    return chars;
  }

  /** Get character at pixel position (for hit testing). Returns id or null.
   *  Agents only: clicks pass straight through the consent greeter, which is
   *  a prop, not something to select or follow. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = Array.from(this.characters.values()).sort((a, b) => b.y - a.y);
    for (const ch of chars) {
      // Skip characters that are despawning
      if (ch.matrixEffect === 'despawn') continue;
      // Character sprite is 16x24, anchored bottom-center
      // Apply sitting offset to match visual position
      const anchorY = ch.y + seatedDrawOffsetPx(ch);
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH;
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH;
      const top = anchorY - CHARACTER_HIT_HEIGHT;
      const bottom = anchorY;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id;
      }
    }
    return null;
  }
}
