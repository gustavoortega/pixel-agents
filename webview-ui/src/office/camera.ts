/**
 * Camera "fit to activity": pick the integer zoom and centre that frame the seats that are in
 * use, and keep them framed without ever jumping the view around.
 *
 * Pure functions plus a tiny controller with an injected clock. The canvas component feeds it
 * once per frame and applies what it returns; nothing here touches the DOM.
 */

import {
  FIT_CENTER_EASE_MS,
  FIT_MARGIN_TILES,
  FIT_MIN_ZOOM,
  FIT_TOP_PAD_TILES,
  TILE_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../constants.js';

/** Inclusive tile bounds. */
export interface TileBox {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
}

export interface MapSize {
  cols: number;
  rows: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface FitResult {
  zoom: number;
  /** Centre of the framed area, in world px. */
  center: Point;
}

/** Bounding box of the seats in use, or null when nobody is seated. */
export function occupiedTileBox(
  seats: Iterable<{ seatCol: number; seatRow: number }>,
): TileBox | null {
  let box: TileBox | null = null;
  for (const s of seats) {
    if (!box) box = { col0: s.seatCol, row0: s.seatRow, col1: s.seatCol, row1: s.seatRow };
    else {
      box.col0 = Math.min(box.col0, s.seatCol);
      box.row0 = Math.min(box.row0, s.seatRow);
      box.col1 = Math.max(box.col1, s.seatCol);
      box.row1 = Math.max(box.row1, s.seatRow);
    }
  }
  return box;
}

/** The box grown by the margin. Deliberately not clamped to the map: a seat by the wall still
 *  wants the same breathing room, and the minimum-zoom rule is what keeps that from zooming out. */
function withMargin(box: TileBox): TileBox {
  return {
    col0: box.col0 - FIT_MARGIN_TILES,
    row0: box.row0 - FIT_MARGIN_TILES - FIT_TOP_PAD_TILES,
    col1: box.col1 + FIT_MARGIN_TILES,
    row1: box.row1 + FIT_MARGIN_TILES,
  };
}

function boxCenter(box: TileBox): Point {
  return {
    x: ((box.col0 + box.col1 + 1) / 2) * TILE_SIZE,
    y: ((box.row0 + box.row1 + 1) / 2) * TILE_SIZE,
  };
}

/** Largest integer zoom at which `tilesW` x `tilesH` tiles fit the canvas (device px). */
function zoomToFit(tilesW: number, tilesH: number, devW: number, devH: number): number {
  return Math.floor(Math.min(devW / (tilesW * TILE_SIZE), devH / (tilesH * TILE_SIZE)));
}

/**
 * Zoom and centre that frame the occupied seats plus a margin, or the whole map when nobody is
 * seated. The zoom is the largest integer that fits, never below FIT_MIN_ZOOM unless the whole
 * map needs less, and clamped to the zoom range. `canvas` is in CSS px; `dpr` converts it.
 */
export function fitView(
  occupied: TileBox | null,
  map: MapSize,
  canvas: { width: number; height: number },
  dpr: number,
): FitResult {
  const devW = canvas.width * dpr;
  const devH = canvas.height * dpr;
  const mapBox: TileBox = {
    col0: 0,
    row0: -FIT_TOP_PAD_TILES,
    col1: map.cols - 1,
    row1: map.rows - 1,
  };
  const box = occupied ? withMargin(occupied) : mapBox;
  const fit = zoomToFit(box.col1 - box.col0 + 1, box.row1 - box.row0 + 1, devW, devH);
  const wholeMapFit = zoomToFit(map.cols, map.rows, devW, devH);
  const floor = Math.min(FIT_MIN_ZOOM, wholeMapFit);
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.max(fit, floor)));
  return { zoom, center: boxCenter(box) };
}

/**
 * What to do when the set of occupied seats changed. Null when the new box (with margin) is
 * already inside the current view. Otherwise the view moves to the box, and the zoom only ever
 * goes OUT: it never zooms back in by itself, so a seat appearing cannot make the room jump
 * closer. The Fit button is how the user asks for the tightest frame.
 */
export function refitView(
  current: FitResult,
  occupied: TileBox | null,
  map: MapSize,
  canvas: { width: number; height: number },
  dpr: number,
): FitResult | null {
  if (!occupied) return null;
  const box = withMargin(occupied);
  const halfW = (canvas.width * dpr) / current.zoom / 2;
  const halfH = (canvas.height * dpr) / current.zoom / 2;
  const inside =
    box.col0 * TILE_SIZE >= current.center.x - halfW &&
    (box.col1 + 1) * TILE_SIZE <= current.center.x + halfW &&
    box.row0 * TILE_SIZE >= current.center.y - halfH &&
    (box.row1 + 1) * TILE_SIZE <= current.center.y + halfH;
  if (inside) return null;
  const target = fitView(occupied, map, canvas, dpr);
  return { zoom: Math.min(current.zoom, target.zoom), center: target.center };
}

/** Pan (device px, as the renderer's `panRef` holds it) that puts `center` in the middle of the canvas. */
export function panForCenter(center: Point, map: MapSize, zoom: number): Point {
  return {
    x: ((map.cols * TILE_SIZE) / 2) * zoom - center.x * zoom,
    y: ((map.rows * TILE_SIZE) / 2) * zoom - center.y * zoom,
  };
}

/** Centre currently framed by a pan; the inverse of panForCenter. */
export function centerForPan(pan: Point, map: MapSize, zoom: number): Point {
  return {
    x: (map.cols * TILE_SIZE) / 2 - pan.x / zoom,
    y: (map.rows * TILE_SIZE) / 2 - pan.y / zoom,
  };
}

/** Ease-in-out between two centres; `t` is elapsed / duration, clamped. */
export function easeCenter(from: Point, to: Point, t: number): Point {
  const k = Math.max(0, Math.min(1, t));
  const e = k * k * (3 - 2 * k);
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}

export interface AutoFitInput {
  occupied: TileBox | null;
  map: MapSize;
  canvas: { width: number; height: number };
  dpr: number;
  zoom: number;
  pan: Point;
  nowMs: number;
  /** The layout editor is open: the view is the user's. */
  editing: boolean;
  /** Camera follow or the greeter is steering the pan. */
  followed: boolean;
}

export interface AutoFitCommand {
  zoom?: number;
  /** Pan for the canvas, valid at `panZoom`; the host applies it once its zoom matches. */
  pan?: Point;
  panZoom?: number;
}

/**
 * Auto-fit state. On at start; any manual zoom or pan, an open editor or a followed agent turns
 * it off, and `enable` (the Fit button) turns it on and frames the occupied seats right away.
 */
export class AutoFit {
  private readonly onChange?: (enabled: boolean) => void;

  constructor(onChange?: (enabled: boolean) => void) {
    this.onChange = onChange;
  }

  private on = true;
  private started = false;
  private lastKey = '';
  private anim: { from: Point; to: Point; startMs: number } | null = null;
  private zoom = 0;

  get enabled(): boolean {
    return this.on;
  }

  /** The user took the camera. */
  disable(): void {
    this.anim = null;
    if (this.on) {
      this.on = false;
      this.onChange?.(false);
    }
  }

  /** Fit button: frame the occupied seats again and keep following changes. */
  enable(): void {
    this.started = false;
    this.anim = null;
    if (!this.on) {
      this.on = true;
      this.onChange?.(true);
    }
  }

  step(input: AutoFitInput): AutoFitCommand {
    if (input.editing || input.followed) this.disable();
    if (!this.on || input.canvas.width <= 0 || input.canvas.height <= 0) return {};
    const { map, canvas, dpr } = input;
    const key = input.occupied ? JSON.stringify(input.occupied) : '';

    if (!this.started) {
      this.started = true;
      this.lastKey = key;
      const fit = fitView(input.occupied, map, canvas, dpr);
      this.zoom = fit.zoom;
      this.anim = null;
      return { zoom: fit.zoom, pan: panForCenter(fit.center, map, fit.zoom), panZoom: fit.zoom };
    }

    if (this.zoom === 0) this.zoom = input.zoom;
    const cmd: AutoFitCommand = {};

    if (key !== this.lastKey) {
      this.lastKey = key;
      const current: FitResult = {
        zoom: this.zoom,
        center: centerForPan(input.pan, map, this.zoom),
      };
      const next = refitView(current, input.occupied, map, canvas, dpr);
      if (next) {
        if (next.zoom !== this.zoom) {
          this.zoom = next.zoom;
          cmd.zoom = next.zoom;
        }
        this.anim = { from: current.center, to: next.center, startMs: input.nowMs };
      }
    }

    if (this.anim) {
      const t = (input.nowMs - this.anim.startMs) / FIT_CENTER_EASE_MS;
      cmd.pan = panForCenter(easeCenter(this.anim.from, this.anim.to, t), map, this.zoom);
      cmd.panZoom = this.zoom;
      if (t >= 1) this.anim = null;
    }
    return cmd;
  }
}
