/**
 * Shared constants — used by the extension host, Vite build scripts,
 * and future standalone backend.
 *
 * No VS Code dependency. Only asset parsing and layout-related values.
 */

// ── PNG / Asset Parsing ─────────────────────────────────────
export const PNG_ALPHA_THRESHOLD = 2;
/** Art pixels per world pixel. Every SpriteData the decoders hand out is at this density: legacy
 *  1x art is upscaled at load, so the renderer never has to know which kind a file was. The
 *  frame, tile and piece sizes below stay in world px; slicing multiplies them by this. */
export const ART_DENSITY = 2;
export const WALL_PIECE_WIDTH = 16;
export const WALL_PIECE_HEIGHT = 32;
export const WALL_GRID_COLS = 4;
export const WALL_BITMASK_COUNT = 16;
export const FLOOR_TILE_SIZE = 16;
export const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const;
export const CHAR_FRAME_W = 16;
export const CHAR_FRAME_H = 32;
export const CHAR_FRAMES_PER_ROW = 7;
/** Idle poses live in a 4th row (after down, up, right): sit-idle, head-down, page-turn A and B,
 *  head-down breathing in, sip. Decoded as frames 7..12 of `down`; sheets that stop at 3 rows (older
 *  or external) lack them, and sheets drawn before the last two poses end the row early. */
export const CHAR_IDLE_ROW = CHARACTER_DIRECTIONS.length;
export const CHAR_IDLE_FRAMES = 6;

// ── Pet Sprite Dimensions (96×96 spritesheet) ──────────────
export const PET_FRAME_W_SMALL = 16;
export const PET_FRAME_H = 32;
export const PET_FRAME_W_LARGE = 32;
export const PET_IMAGE_WIDTH = 96;
export const PET_IMAGE_HEIGHT = 96;
export const PET_WALK_FRAMES_VERT = 3;
export const PET_IDLE_FRAMES_VERT = 3;
export const PET_WALK_FRAMES_HORIZ = 3;
export const MAX_PET_PNG_SIZE = 512 * 1024; // 512 KB cap per pet PNG

// ── Carpet auto-tile parsing ────────────────────────────────
export const CARPET_TILE_SIZE = 16;
export const CARPET_GRID_COLS = 4;
export const CARPET_MARCHING_SQUARES_COUNT = 16;
