import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;

// ── Idle life (iteration 3a) ─────────────────────────────────
/** A pose is re-evaluated this often even when the status did not change. */
export const POSE_TICK_SEC = 60;
/** A status other than active must hold this long before the pose follows it: a status that
 *  flips every couple of seconds never moves the pose (going active is always immediate). */
export const POSE_SETTLE_SEC = 4;
/** Reading turns to napping after this long idle, and never goes back within the idle span. */
export const NAP_AFTER_IDLE_SEC = 600;
/** One in this many agents (by seed) is a coffee drinker. */
export const COFFEE_SEED_MODULUS = 3;
export const COFFEE_MIN_IDLE_SEC = 120;
export const COFFEE_MIN_STAY_SEC = 60;
export const COFFEE_COOLDOWN_SEC = 600;
export const SOFA_MAX_OCCUPANTS = 2;
/** Seconds one page of the book stays up before the page-turn frame swaps. */
export const READING_PAGE_TURN_SEC = 2.5;
/** Rising "Zz" of a napping agent: one cycle, and how many glyph rows it climbs (cells at zoom 1). */
export const NAP_ZZ_PERIOD_MS = 2400;
export const NAP_ZZ_RISE_CELLS = 5;
export const NAP_ZZ_CELL_PX = 1;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_TRAIL_LENGTH = 6;
export const MATRIX_SPRITE_COLS = 16;
export const MATRIX_SPRITE_ROWS = 24;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
/** A face-on desk seat sinks its sprite until the desk top hides this many px of the sprite's bottom
 *  (the desk sorts in front of a seated agent; the sink only makes the cover real). */
export const DESK_SEAT_COVER_PX = 12;
/** A couch's front part hides this many px of the sprite's bottom: the cut row is derived from it. */
export const SOFA_FRONT_COVER_PX = 10;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
/** Headless agents (adopted, no terminal to focus) render slightly translucent. */
export const HEADLESS_CHARACTER_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3];
export const BUTTON_MIN_RADIUS = 6;
export const BUTTON_RADIUS_ZOOM_FACTOR = 3;
export const BUTTON_ICON_SIZE_FACTOR = 0.45;
export const BUTTON_LINE_WIDTH_MIN = 1.5;
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Tripwire alarm ───────────────────────────────────────────
export const TRIPWIRE_COLOR_HIGH = '#e53935';
export const TRIPWIRE_COLOR_MEDIUM = '#ffb300';
export const TRIPWIRE_COLOR_LOW = '#fdd835';
/** Beacon flash period in ms. */
export const TRIPWIRE_FLASH_PERIOD_MS = 700;
/** Beacon radius in sprite pixels (scaled by zoom). */
export const TRIPWIRE_BEACON_RADIUS_PX = 3;

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2];
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
export const ZOOM_DEFAULT_DPR_FACTOR = 2;
export const ZOOM_SCROLL_THRESHOLD = 50;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;

// ── Layout Import/Export (browser-native, standalone) ────────
/** Suggested filename when exporting the office layout from the standalone browser. */
export const LAYOUT_EXPORT_FILENAME = 'pixel-agents-layout.json';
/** MIME type for the exported layout Blob. */
export const LAYOUT_EXPORT_MIME = 'application/json';
export const DEFAULT_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
export const DEFAULT_WALL_COLOR: ColorValue = { h: 240, s: 25, b: 0, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

// ── Carpets ──────────────────────────────────────────────────
/** Main (lowest-luminance) color applied to carpets when no per-tile override is set. */
export const CARPET_DEFAULT_COLOR: ColorValue = { h: 0, s: 71, b: -32, c: 0, colorize: true };
/** Accent (highest-luminance) color applied to carpets when no per-tile override is set. */
export const CARPET_DEFAULT_ACCENT_COLOR: ColorValue = {
  h: 34,
  s: 64,
  b: 21,
  c: 0,
  colorize: true,
};
/** Keyboard key that switches from CARPET_PAINT to CARPET_PICK while editing. */
export const KEY_CARPET_PICK = 'p';

// ── Areas (named, colored workspace-folder zones) ────────────
/** Color palette assigned to new Areas in rotation (cycles when more areas exist). */
export const AREA_DEFAULT_COLORS: readonly string[] = [
  '#ff6b6b',
  '#feca57',
  '#48dbfb',
  '#1dd1a1',
  '#5f27cd',
  '#ff9ff3',
  '#54a0ff',
  '#ffa502',
] as const;
/** Translucent overlay alpha for area tile fills. */
export const AREA_OVERLAY_ALPHA = 0.25;
/** Alpha multiplier applied to the actively-selected area's overlay. */
export const AREA_ACTIVE_ALPHA_MULTIPLIER = 1.6;
/** Base font size (pixel-pre-zoom) of a room plaque: with its border and shadow it fills one wall tile band. */
export const AREA_LABEL_FONT_SIZE_PX = 8;
/** Minimum on-screen label size to keep labels legible at low zoom. */
export const AREA_LABEL_MIN_FONT_SIZE_PX = 12;
/** Alpha of the area label text. */
export const AREA_LABEL_ALPHA = 1.0;
/** Fallback label color when an area has no color set (shouldn't happen in practice). */
export const AREA_LABEL_FALLBACK_COLOR = '#ffffff';
/** Drop-shadow color behind area labels for legibility on light backgrounds. */
export const AREA_LABEL_SHADOW_COLOR = '#000000';
/** Drop-shadow alpha behind area labels. */
export const AREA_LABEL_SHADOW_ALPHA = 0.6;

// ── VisualColorPicker (HSV wheel + brightness for carpets) ───
export const VISUAL_COLOR_PICKER_SV_SIZE_PX = 180;
export const VISUAL_COLOR_PICKER_HUE_WIDTH_PX = 20;
export const VISUAL_COLOR_PICKER_MARKER_RADIUS_PX = 6;
/**
 * The hue bar gradient is intrinsic to the color-picking interaction, not a
 * theme color — it must span the full hue circle. Centralized here so the
 * component body stays free of inline color literals. (The saturation/brightness
 * square is painted to a canvas from the carpet HSL model, not a CSS gradient.)
 */
export const VISUAL_COLOR_PICKER_HUE_GRADIENT =
  'linear-gradient(to bottom, ' +
  '#ff0000 0%, #ffff00 16.7%, #00ff00 33.3%, ' +
  '#00ffff 50%, #0000ff 66.7%, #ff00ff 83.3%, #ff0000 100%)';
export const VISUAL_COLOR_PICKER_MARKER_BORDER = '2px solid #fff';
export const VISUAL_COLOR_PICKER_MARKER_SHADOW = '0 0 0 1px rgba(0,0,0,0.6)';
/** Width of the collapsed swatch + hex trigger row (compact mode). */
export const VISUAL_COLOR_PICKER_COMPACT_WIDTH_PX = 160;
/** Swatch square size shown in the collapsed trigger. */
export const VISUAL_COLOR_PICKER_SWATCH_PX = 22;
/** Gap (px) between the collapsed trigger and the expanded popup panel. */
export const VISUAL_COLOR_PICKER_POPUP_GAP_PX = 6;

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// Tripwire alarm: two quick alternating tones, harsher than the chimes above
export const ALARM_NOTE_1_HZ = 987.77; // B5
export const ALARM_NOTE_2_HZ = 740; // F#5
export const ALARM_NOTE_1_START_SEC = 0;
export const ALARM_NOTE_2_START_SEC = 0.14;
export const ALARM_NOTE_DURATION_SEC = 0.12;
export const ALARM_VOLUME = 0.14;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
/** Default/fallback palette count (bundled characters). Actual count comes from getLoadedCharacterCount(). */
export const PALETTE_COUNT = 12;
/** Skin ramp of the bundled characters plus each tone's mouth shade, as the PNG decoder reports
 *  them (uppercase). The hue shift skips these pixels so a repeated palette keeps a human skin tone.
 *  Mirrors SKIN_RAMP in scripts/cozy-art/characters.ts. */
export const SKIN_TONES: ReadonlySet<string> = new Set([
  '#F6D9B8',
  '#F2C9A0',
  '#C98D5E',
  '#8D5A3B',
  '#5A3A28',
  '#998772',
  '#967D63',
  '#7D573A',
  '#573825',
  '#382419',
]);
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 24;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32;
/** Seat pitch in tiles: a nameplate may not be wider than one pod's slot minus a gap. The layout
 *  validator guarantees pods sit at least this far apart, so neighbouring plates never overlap. */
export const COMPACT_LABEL_SEAT_PITCH_TILES = 2.5;
export const COMPACT_LABEL_GAP_PX = 8;
/** Below this width a nameplate is just a marker (it would be a few letters of ellipsis). */
export const COMPACT_LABEL_MIN_WIDTH_PX = 90;
/** Unit of the label layout's displacement budget (LABEL_LAYOUT_MAX_DISPLACEMENT_LINES of these), CSS px. */
export const COMPACT_LABEL_LINE_HEIGHT_PX = 18;
/** Clear space between the character's feet and a plate placed below them, CSS px. */
export const COMPACT_LABEL_FEET_GAP_PX = 2;
/** World px between the head top and a plate placed above it. */
export const NAMEPLATE_HEAD_GAP_PX = 2;
/** Extra world px the plate rises when something else owns the slot right above the head: a speech
 *  bubble, the idle glyph, the napping Zz or the tripwire beacon, all drawn on the canvas. */
export const NAMEPLATE_SLOT_CLEARANCE_PX = 16;
/** Height of a character sprite frame, px: its head top row is measured from its top edge. */
export const CHARACTER_SPRITE_HEIGHT_PX = 32;
/** Plates scale with the zoom relative to the zoom at which the whole map fits, between these. */
export const PLATE_SCALE_MIN = 0.6;
export const PLATE_SCALE_MAX = 1.5;
/** Below this scale the plate drops its title (second) line and keeps `Lv N  Name`. */
export const PLATE_TITLE_MIN_SCALE = 1;
/** Nameplate box, CSS px. Line 1 is the badge + member name, line 2 the session label. */
export const NAMEPLATE_LINE1_PX = 20;
export const NAMEPLATE_LINE2_PX = 16;
export const NAMEPLATE_PAD_Y_PX = 2;
export const NAMEPLATE_BORDER_PX = 3;
/** Hard shadow under the plate (`.nameplate` in index.css) and the gap before the tripwire pill. */
export const NAMEPLATE_SHADOW_PX = 3;
/** Plate type sizes, CSS px: the member name and the session title. */
export const NAMEPLATE_NAME_FONT_PX = 17;
export const NAMEPLATE_SUB_FONT_PX = 12;
/** Plate colors. The border and shadow are the same for every tier; the tier only colors the Lv badge. */
export const NAMEPLATE_BG = '#3b2412';
export const NAMEPLATE_BORDER_COLOR = '#1e120a';
export const NAMEPLATE_TEXT_COLOR = '#fff4dc';
export const NAMEPLATE_SUB_BG = 'rgba(59, 36, 18, 0.7)';
export const NAMEPLATE_BADGE_INK = '#3b2412';
/** Lv badge background for Haiku and an unknown model. */
export const NAMEPLATE_BADGE_GOLD = '#f6c64a';
export const NAMEPLATE_PILL_HEIGHT_PX = 18;
export const NAMEPLATE_PILL_GAP_PX = 2;
/** Extra clearance a displaced label keeps from what it was pushed off, CSS px. */
export const LABEL_LAYOUT_PAD_PX = 2;
/** A label pushed further than this many lines stays put and dims instead. */
export const LABEL_LAYOUT_MAX_DISPLACEMENT_LINES = 3;
export const LABEL_LAYOUT_DIM_OPACITY = 0.35;
/** Room sign plate: padding and per-glyph width estimate (no measureText, so it stays pure). */
export const AREA_SIGN_PADDING_PX = 2;
export const AREA_SIGN_GLYPH_WIDTH_EM = 0.4;
/** Room plaque in the wall palette: plate, border (also the hard bottom shadow) and ink text. */
export const AREA_SIGN_PLATE_COLOR = '#d9b989';
export const AREA_SIGN_BORDER_COLOR = '#6b4128';
export const AREA_SIGN_TEXT_COLOR = '#3b2412';
/** Plaque border and bottom shadow thickness, in zoom px (world px, scaled by the zoom). */
export const AREA_SIGN_BORDER_PX = 3;
export const AREA_SIGN_SHADOW_PX = 2;
/** Thin usage bar along the bottom of a room sign: track colour and height in world px. */
export const AREA_SIGN_USAGE_TRACK_COLOR = 'rgba(255, 255, 255, 0.18)';
export const AREA_SIGN_USAGE_BAR_HEIGHT_PX = 1;
/** "z" glyph of an idle agent. */
export const IDLE_GLYPH_COLOR = '#b8c4e0';
export const IDLE_GLYPH_SHADOW_COLOR = 'rgba(0, 0, 0, 0.6)';

// ── Greeter + Intro bubble ──────────────────────────────────
/** Reserved character id for the Intro's greeter. Far outside both real agent
 *  ids (positive) and sub-agent ids (small negatives from -1 down). */
export const GREETER_ID = -1_000_000_000;
/** Stacking order for the Intro's bubble. Deliberately BELOW the modal stack
 *  (ui/Modal defaults to 50, ChangelogModal 51, the migration notice z-100): the
 *  Intro is diegetic furniture over the office, not a modal, so a modal opened
 *  on top of it must cover it rather than slide underneath. */
export const INTRO_BUBBLE_Z_INDEX = 45;
/** The greeter stands this many tiles in from the office's bottom-left corner
 *  (target tile (margin, rows-1-margin); nearest walkable tile if blocked). */
export const GREETER_TILE_MARGIN = 3;
/** World px above the greeter's anchor (feet) where the bubble's bottom sits.
 *  Kept well above the head target (INTRO_TAIL_TARGET_RISE_WORLD) so the
 *  tail squares have a visible run between bubble and head. */
export const INTRO_BUBBLE_ANCHOR_RISE_WORLD = 44;
/** World px right of the greeter's center where the bubble's left edge starts —
 *  just clear of the sprite so the tail points down-left at the head. */
export const INTRO_BUBBLE_OFFSET_X_WORLD = 10;
/** Bubble width cap (CSS px) and the margin kept from the container edges.
 *  Wide on purpose: the disclosure reads as three short paragraphs instead of
 *  a tall column (still clamped to the container on narrow panels). */
export const INTRO_BUBBLE_MAX_WIDTH_PX = 560;
export const INTRO_BUBBLE_EDGE_MARGIN_PX = 4;
/** Where the Intro's Claude Code step sends people who don't have it yet. */
export const CLAUDE_CODE_URL = 'https://claude.com/claude-code';
export const CLAUDE_CODE_INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code';
/** Speech-tail squares: placed at fraction `t` along the segment from the
 *  bubble's nearest edge point to the greeter's head, shrinking toward the
 *  speaker. Recomputed every frame so the tail stays connected no matter where
 *  edge-clamping or panning puts the bubble relative to the character. */
export const INTRO_TAIL_STEPS = [
  { t: 0.25, size: 12 },
  { t: 0.55, size: 9 },
  { t: 0.82, size: 6 },
] as const;
/** World px above the greeter's anchor (feet) the tail points at — the head. */
export const INTRO_TAIL_TARGET_RISE_WORLD = 26;
/** Camera-offset caps while centering character + bubble. The ideal composition
 *  assumes the bubble fits beside/above the character; when it can't (narrow or
 *  short viewports clamp the bubble to the screen), uncapped offsets shove the
 *  greeter to the viewport edge. Horizontal offset is capped to this fraction
 *  of the viewport; vertical offset always keeps this many world px of the
 *  character visible above the bottom edge. */
export const INTRO_CAMERA_MAX_X_OFFSET_VIEWPORT_FRACTION = 0.25;
export const INTRO_CAMERA_MIN_CHAR_VISIBLE_WORLD = 48;
/** Extra downward camera shift (CSS px) so the character+bubble composition
 *  sits a bit above the vertical center instead of dead-centered. */
export const INTRO_CAMERA_DOWN_SHIFT_PX = 50;

// ── Context Fuel Gauge ──────────────────────────────────────
/** Window assumed before the runtime reports one (it always does for agents
 *  that have taken a turn; this only covers characters created ahead of it). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
export const CONTEXT_WARN_THRESHOLD = 0.6;
export const CONTEXT_DANGER_THRESHOLD = 0.8;
export const CONTEXT_CRITICAL_THRESHOLD = 0.95;
export const CONTEXT_GAUGE_WIDTH_PX = 40;
export const CONTEXT_GAUGE_HEIGHT_PX = 4;
export const CONTEXT_GAUGE_COLOR_OK = '#44cc44';
export const CONTEXT_GAUGE_COLOR_WARN = '#ffcc00';
export const CONTEXT_GAUGE_COLOR_DANGER = '#ff8800';
export const CONTEXT_GAUGE_COLOR_CRITICAL = '#ff2222';
export const CONTEXT_GAUGE_BG = '#222';

// ── Agent Teams ─────────────────────────────────────────────
export const TEAM_LEAD_COLOR = '#ffd700';
export const TEAM_ROLE_COLOR = '#66aaff';

// ── Pets ────────────────────────────────────────────────────────
/** Walking speed in world pixels per second (matches character walk speed visually but slower). */
export const PET_WALK_SPEED_PX_PER_SEC = 32;
/** Time per WALK animation cycle step (4 cycle steps × 0.15s = 0.6s per loop). */
export const PET_WALK_FRAME_DURATION_SEC = 0.15;
/** Time per IDLE animation cycle step (4 cycle steps × 0.3s = 1.2s per loop). */
export const PET_IDLE_FRAME_DURATION_SEC = 0.3;
/** Walk cycle: 4-step lookup into the 3-frame walkDown/walkUp/walkRight arrays. */
export const PET_WALK_SEQUENCE = [0, 1, 0, 2] as const;
/** Idle cycle: 4-step lookup into the 3-frame idleDown/idleUp arrays. */
export const PET_IDLE_SEQUENCE = [0, 1, 2, 1] as const;
/** Minimum seconds the pet stays in IDLE before making a new decision. */
export const PET_WANDER_PAUSE_MIN_SEC = 3.0;
/** Maximum seconds the pet stays in IDLE before making a new decision. */
export const PET_WANDER_PAUSE_MAX_SEC = 15.0;
/** Seconds between FOLLOW path re-computations. */
export const PET_FOLLOW_RECALC_INTERVAL_SEC = 1.0;
/** Probability that a pet enters FOLLOW (instead of WALK) when wanderTimer expires. */
export const PET_FOLLOW_CHANCE = 0.3;
/** Maximum Manhattan distance (tiles) at which a character can become a follow target. */
export const PET_FOLLOW_RADIUS_TILES = 3;
/** Minimum seconds a FOLLOW episode lasts before timing out. */
export const PET_FOLLOW_DURATION_MIN_SEC = 5.0;
/** Maximum seconds a FOLLOW episode lasts before timing out. */
export const PET_FOLLOW_DURATION_MAX_SEC = 15.0;
/** Hit-box half-width (world px) for pet click detection. */
export const PET_HIT_HALF_WIDTH = 8;
/** Hit-box height (world px) measured upward from the bottom-center anchor. */
export const PET_HIT_HEIGHT = 16;
/** Zoom factor used to draw pet thumbnails in the EditorToolbar Pets tab. */
export const PET_THUMB_ZOOM = 2;
/** Scale margin so the pet thumbnail fills the ItemSelect cell without touching the edges. */
export const PET_THUMB_SCALE_MARGIN = 0.85;
/** Fallback background fill for sprite-less thumbnail (used while pet sprites are loading). */
export const EMPTY_SPRITE_THUMBNAIL_BG = '#333';
/** Maximum string length for a PlacedPet.id (defends against pathologically-long layout entries). */
export const MAX_PET_ID_LENGTH = 128;

// ── Model look (rarity, equipment, companion) ───────────────────
/** Rarity colors, the same four everywhere the look shows: label plate, outline, shimmer. */
export const RARITY_COLORS = {
  common: '#9d9d9d',
  rare: '#3d8bff',
  epic: '#a335ee',
  legendary: '#ff8000',
} as const;
/** Equipment in front of the body sorts just after it, so it is never hidden by it. */
export const ACCESSORY_FRONT_Z_OFFSET = 0.001;
/** A cape behind the body sorts between the rarity outline (-0.001) and the body. */
export const CAPE_BEHIND_Z_OFFSET = 0.0005;
/** A cape facing away from the camera (up) hangs over the body instead. */
export const CAPE_OVER_Z_OFFSET = 0.0005;
/** Sparkle twinkle cycle: alpha swings between the floor and 1 over this period. */
export const SPARKLE_PERIOD_MS = 1400;
export const SPARKLE_MIN_ALPHA = 0.2;
/** Companion hover height for flying kinds (bird, dragon), world px. */
export const COMPANION_HOVER_PX = 6;
/** Flying companions bob 1 px up every this many seconds. */
export const COMPANION_BOB_INTERVAL_SEC = 0.4;
/** Companion glide speed toward its tile, world px/s. Faster than the agent so it keeps up. */
export const COMPANION_SPEED_PX_PER_SEC = 64;
export const COMPANION_IDLE_FRAME_DURATION_SEC = 0.6;
export const COMPANION_MOVE_FRAME_DURATION_SEC = 0.15;
/** Gap between a companion's feet and the bottom of its tile, world px. */
export const COMPANION_FEET_INSET_PX = 2;
/** Tiles an agent has left behind that a companion remembers; it only ever uses the last one. */
export const COMPANION_TRAIL_LENGTH = 2;
/** A companion standing on a desk sorts this far in front of the desk's bottom edge, world px. */
export const COMPANION_DESK_Z_OFFSET = 0.01;
/** Outline of the legendary label plate shimmers once per this many seconds. */
export const RARITY_SHIMMER_SEC = 2.4;

// ── Cozy look: shadows ──────────────────────────────────────────
/** Oval under every character. Sub-agents and companions get the small one. */
export const SHADOW_COLOR = 'rgba(40, 20, 10, 0.28)';
export const SHADOW_SIZE_PX = { w: 12, h: 4 } as const;
export const SHADOW_SMALL_SIZE_PX = { w: 8, h: 3 } as const;
/** Sorts just under the rarity outline (-OUTLINE_Z_SORT_OFFSET), so the oval is never over a body. */
export const SHADOW_Z_SORT_OFFSET = 0.002;

// ── Cozy look: lighting ─────────────────────────────────────────
/** Local-time phases, in minutes after midnight. Dawn 06:00-06:59, golden hour 16:00-19:59,
 *  night 20:00-05:59, plain daylight otherwise. */
export const LIGHT_DAWN_START_MIN = 6 * 60;
export const LIGHT_DAY_START_MIN = 7 * 60;
export const LIGHT_GOLDEN_START_MIN = 16 * 60;
export const LIGHT_NIGHT_START_MIN = 20 * 60;
/** Tint over the map (DOM, soft-light) and the glow strengths, per phase. Strengths are 0..1
 *  multipliers on the cached glow sprites; 0 means that glow is not drawn in that phase. */
export const LIGHT_PHASES = {
  night: {
    tint: { color: '#2a3570', alpha: 0.24 },
    monitorGlow: 0.75,
    lampGlow: 0.6,
    windowShaft: 0,
  },
  dawn: {
    tint: { color: '#ffb0a0', alpha: 0.15 },
    monitorGlow: 0.4,
    lampGlow: 0.3,
    windowShaft: 0,
  },
  day: { tint: null, monitorGlow: 0.3, lampGlow: 0, windowShaft: 0.18 },
  golden: {
    tint: { color: '#ff9a3c', alpha: 0.28 },
    monitorGlow: 0.45,
    lampGlow: 0.35,
    windowShaft: 0.3,
  },
} as const;
/** Glow radii in tiles, and how far below its anchor tile a monitor glow is centered so it
 *  lights the face or the desk without painting the wall row above. */
export const GLOW_MONITOR_RADIUS_TILES = 2;
export const GLOW_LAMP_RADIUS_TILES = 2.5;
export const GLOW_DOWN_OFFSET_TILES = 0.5;
/** Window light shaft, in tiles: width, and length from the window's bottom edge downward. */
export const GLOW_SHAFT_WIDTH_TILES = 3;
export const GLOW_SHAFT_LENGTH_TILES = 4;
/** Radial glow gradient stops (centre, edge) per kind; the shaft is a vertical gradient. */
export const GLOW_COLORS = {
  monitor: { core: 'rgba(130, 255, 200, 0.45)', edge: 'rgba(130, 255, 200, 0)' },
  lamp: { core: 'rgba(255, 200, 110, 0.55)', edge: 'rgba(255, 200, 110, 0)' },
  shaft: { core: 'rgba(255, 190, 110, 0.5)', edge: 'rgba(255, 190, 110, 0)' },
} as const;
/** Map vignette: the edges darken toward this color, starting at this share of the radius. */
export const VIGNETTE_COLOR = 'rgba(50, 20, 5, 0.35)';
export const VIGNETTE_CLEAR_RADIUS_PCT = 55;
/** Furniture ids that emit light. */
export const LIGHT_FIXTURE_WINDOW = 'WINDOW';
export const LIGHT_FIXTURE_LAMP = 'FLOOR_LAMP';
/** Footprint of the window (tiles) and the lamp head's height above the lamp's top tile, world px. */
export const WINDOW_FOOTPRINT_W_TILES = 2;
export const WINDOW_FOOTPRINT_H_TILES = 2;
export const LAMP_HEAD_OFFSET_PX = 6;
/** HUD clock refresh, ms. */
export const HUD_CLOCK_REFRESH_MS = 15_000;

// ── Cozy look: camera fit ───────────────────────────────────────
/** Margin around the framed rooms, in tiles. The rooms' own floor is the frame: plates are clamped inside it. */
export const FIT_MARGIN_TILES = 1;
/** Furniture type that marks the lounge: the Area holding it is the lounge room. */
export const LOUNGE_FURNITURE_TYPE = 'COFFEE_TABLE';
/** The fit frames at least this many rooms (or the whole map when it has fewer). */
export const FIT_MIN_ROOMS = 2;
export const FIT_CENTER_EASE_MS = 300;
