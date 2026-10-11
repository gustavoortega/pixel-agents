import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  NAP_BREATH_SEC,
  POSE_SETTLE_SEC,
  POSE_TICK_SEC,
  READING_PAGE_TURN_SEC,
  SEAT_REST_MAX_SEC,
  SEAT_REST_MIN_SEC,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_MOVES_BEFORE_REST_MAX,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
} from '../../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import { isReadingToolName } from '../toolUtils.js';
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, IdlePose, TILE_SIZE, WorkStatus } from '../types.js';

/** Whether a tool should show the reading animation (vs typing). Taxonomy comes
 *  from the active HookProvider via the `providerCapabilities` message. */
export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return isReadingToolName(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
  initialActive = true,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: initialActive ? CharacterState.TYPE : CharacterState.IDLE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: initialActive,
    agentStatus: initialActive ? WorkStatus.ACTIVE : WorkStatus.IDLE,
    // An agent that starts idle is already settled into reading: no pose to wait for.
    pose: initialActive ? IdlePose.TYPING : IdlePose.READING,
    poseStatus: initialActive ? WorkStatus.ACTIVE : WorkStatus.IDLE,
    idleSec: 0,
    poseSettleSec: POSE_SETTLE_SEC,
    poseTickSec: POSE_TICK_SEC,
    poseClockSec: 0,
    coffeeCooldownSec: 0,
    drawSink: 0,
    trip: null,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    contextTokens: 0,
    maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  };
}

/**
 * Tiles an idle agent may wander to: the ones in its seat's area, so agents
 * stay in their own room. Falls back to every walkable tile when the seat has
 * no area or its area has nowhere to walk.
 */
export function wanderCandidates(
  walkableTiles: Array<{ col: number; row: number }>,
  seat: { seatCol: number; seatRow: number } | undefined,
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
): Array<{ col: number; row: number }> {
  if (!seat || !areaTiles || cols <= 0) return walkableTiles;
  const area = areaTiles[seat.seatRow * cols + seat.seatCol];
  if (!area) return walkableTiles;
  const inArea = walkableTiles.filter((t) => areaTiles[t.row * cols + t.col] === area);
  return inArea.length > 0 ? inArea : walkableTiles;
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  areaTiles?: ReadonlyArray<string | null>,
  cols = 0,
): void {
  ch.frameTimer += dt;

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      // No longer active: a seated agent stays in its seat (the idle pose decides what it does
      // there); one with no seat has nothing to sit at, so it stands up and wanders.
      if (!ch.isActive) {
        if (ch.seatId) {
          ch.seatTimer = 0; // clear the turn-end sentinel
          break;
        }
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel
      // If became active, pathfind to seat
      if (ch.isActive) {
        if (!ch.seatId) {
          // No seat assigned — type in place
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        const seat = seats.get(ch.seatId);
        if (seat) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            tileMap,
            blockedTiles,
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
          }
        }
        break;
      }
      // Not active, with a seat: idle agents live at their desk (reading, napping), so they sit
      // at once when they are there and walk back after a short pause when they are not.
      const ownSeat = ch.seatId ? seats.get(ch.seatId) : undefined;
      if (ownSeat) {
        if (ch.tileCol === ownSeat.seatCol && ch.tileRow === ownSeat.seatRow) {
          ch.state = CharacterState.TYPE;
          ch.dir = ownSeat.facingDir;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        ch.wanderTimer -= dt;
        if (ch.wanderTimer <= 0) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            ownSeat.seatCol,
            ownSeat.seatRow,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
        break;
      }
      // Countdown wander timer
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        const candidates = wanderCandidates(
          walkableTiles,
          ch.seatId ? seats.get(ch.seatId) : undefined,
          areaTiles,
          cols,
        );
        if (candidates.length > 0) {
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        if (ch.isActive) {
          if (!ch.seatId) {
            // No seat — type in place
            ch.state = CharacterState.TYPE;
          } else {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
            } else {
              ch.state = CharacterState.IDLE;
            }
          }
        } else {
          // Check if arrived at assigned seat — sit down for a rest before wandering again
          if (ch.seatId) {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              // seatTimer < 0 is a sentinel from setAgentActive(false) meaning
              // "turn just ended" — skip the long rest so idle transition is immediate
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0;
              } else {
                ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              }
              ch.wanderCount = 0;
              ch.wanderLimit = randomInt(
                WANDER_MOVES_BEFORE_REST_MIN,
                WANDER_MOVES_BEFORE_REST_MAX,
              );
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path
      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;
      }

      // If became active while wandering, repath to seat
      if (ch.isActive && ch.seatId) {
        const seat = seats.get(ch.seatId);
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1];
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            const newPath = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (newPath.length > 0) {
              ch.path = newPath;
              ch.moveProgress = 0;
            }
          }
        }
      }
      break;
    }
  }
}

/** Which animation set of a character's sheet is playing, and the index within it. */
export type SheetAnimation =
  | { set: 'walk'; index: number }
  | { set: 'typing'; index: number }
  | { set: 'reading'; index: number }
  | { set: 'idle'; index: number };

/** Sheet frame behind each animation step: walk1-3 (the cycle revisits walk2), type1-2, read1-2. */
const WALK_SHEET_FRAMES = [0, 1, 2, 1] as const;
const TYPING_SHEET_FRAMES = [3, 4] as const;
const READING_SHEET_FRAMES = [5, 6] as const;
/** The idle row, appended to `down`: sit-idle, head-down, page-turn A, page-turn B, head-down
 *  breathing in, sip. */
const IDLE_SHEET_FRAMES = [7, 8, 9, 10, 11, 12] as const;
const IDLE_SIT = 0;
const IDLE_NAP = 1;
const IDLE_PAGE_A = 2;
const IDLE_NAP_BREATH = 4;
const IDLE_SIP = 5;

/** Which of the two nap frames is up: head-down and breathing in, swapped every NAP_BREATH_SEC. */
function napFrame(ch: Pick<Character, 'poseClockSec'>): number {
  return Math.floor(ch.poseClockSec / NAP_BREATH_SEC) % 2 === 0 ? IDLE_NAP : IDLE_NAP_BREATH;
}

/** Which page-turn frame (0 or 1) of the reading pose is up: it flips every READING_PAGE_TURN_SEC. */
export function readingPage(ch: Pick<Character, 'poseClockSec'>): number {
  return Math.floor(ch.poseClockSec / READING_PAGE_TURN_SEC) % 2;
}

/** The one place that maps a character's state to a frame of its sheet. */
export function characterAnimation(ch: Character): SheetAnimation {
  switch (ch.state) {
    case CharacterState.TYPE: {
      // The idle poses are authored front view only; facing any other way the seated agent keeps
      // the typing frame (the book is baked into the reading frames, the nap and the mug are not drawn).
      const front = ch.dir === Direction.DOWN;
      switch (ch.pose) {
        case IdlePose.WAIT_BUBBLE:
          return front ? { set: 'idle', index: IDLE_SIT } : { set: 'typing', index: 0 };
        case IdlePose.COFFEE:
          return front ? { set: 'idle', index: IDLE_SIP } : { set: 'typing', index: 0 };
        case IdlePose.NAPPING:
          return front ? { set: 'idle', index: napFrame(ch) } : { set: 'typing', index: 0 };
        case IdlePose.READING: {
          const page = readingPage(ch);
          return front
            ? { set: 'idle', index: IDLE_PAGE_A + page }
            : { set: 'reading', index: page };
        }
        default:
          return isReadingTool(ch.currentTool)
            ? { set: 'reading', index: ch.frame % 2 }
            : { set: 'typing', index: ch.frame % 2 };
      }
    }
    case CharacterState.WALK:
      return { set: 'walk', index: ch.frame % 4 };
    default:
      // Idle reuses the second walk frame
      return { set: 'walk', index: 1 };
  }
}

/** Frame of the character sheet currently drawn (0-6, and 7-12 for the idle row); equipment bobs with it. */
export function sheetFrameIndex(ch: Character): number {
  const anim = characterAnimation(ch);
  switch (anim.set) {
    case 'reading':
      return READING_SHEET_FRAMES[anim.index];
    case 'typing':
      return TYPING_SHEET_FRAMES[anim.index];
    case 'idle':
      return IDLE_SHEET_FRAMES[anim.index];
    default:
      return WALK_SHEET_FRAMES[anim.index];
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  const anim = characterAnimation(ch);
  if (anim.set === 'idle') return sprites.idle[anim.index];
  return sprites[anim.set][ch.dir][anim.index];
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
