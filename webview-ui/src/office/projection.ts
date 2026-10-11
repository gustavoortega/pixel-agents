/**
 * World coordinates → screen coordinates, in one place.
 *
 * The office is drawn by centering the map in the canvas and then applying the
 * pan, both snapped to whole device pixels so sprites stay on the pixel grid.
 * That formula was reproduced in the renderer and in each DOM overlay that
 * floats something above a character; a copy that rounds differently puts the
 * overlay a pixel off the sprite it is labelling, which is invisible in review
 * and obvious on screen.
 *
 * Deliberately free of DOM access — `dpr` is passed in, not read from
 * `window`. Reading the environment belongs at the component boundary; a state
 * or math module that reaches for `window` drags the DOM into every module
 * graph that imports it.
 */

import { TILE_SIZE } from './types.js';

/** Device-pixel offset of the map's top-left corner inside the canvas.
 *  This is the renderer's own frame of reference — overlays go through
 *  {@link overlayProjection} instead of calling this directly. */
export function mapOffset(
  canvasWidth: number,
  canvasHeight: number,
  cols: number,
  rows: number,
  zoom: number,
  panX: number,
  panY: number,
): { offsetX: number; offsetY: number } {
  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;
  return {
    offsetX: Math.floor((canvasWidth - mapW) / 2) + Math.round(panX),
    offsetY: Math.floor((canvasHeight - mapH) / 2) + Math.round(panY),
  };
}

/** Where the map sits on the canvas and how big a world px is there. */
export interface DeviceView {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

/**
 * Device px of a world point. The one snapping rule for the canvas and the DOM overlays (which
 * divide by dpr): scale first, round once. World positions can be half px (one art px at
 * ART_DENSITY 2), and rounding before scaling would throw that half away at every zoom.
 */
export function worldToDevice(view: DeviceView, x: number, y: number): { x: number; y: number } {
  return {
    x: view.offsetX + Math.round(x * view.zoom),
    y: view.offsetY + Math.round(y * view.zoom),
  };
}

/** Projects world points into CSS pixels within the overlay container that
 *  sits on top of the canvas. */
export interface OverlayProjection {
  toScreenX(worldX: number): number;
  toScreenY(worldY: number): number;
  /** Container size in world units — what the viewport currently covers.
   *  Used to cap overlay offsets against the visible area. */
  readonly viewportWorldWidth: number;
  readonly viewportWorldHeight: number;
  /** CSS px → world units, for sizing overlay geometry in world terms. */
  toWorldLength(cssPx: number): number;
}

export function overlayProjection(
  layout: { cols: number; rows: number },
  containerRect: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
  dpr: number,
): OverlayProjection {
  const canvasW = Math.round(containerRect.width * dpr);
  const canvasH = Math.round(containerRect.height * dpr);
  const { offsetX, offsetY } = mapOffset(
    canvasW,
    canvasH,
    layout.cols,
    layout.rows,
    zoom,
    pan.x,
    pan.y,
  );
  const view = { offsetX, offsetY, zoom };
  return {
    toScreenX: (worldX) => worldToDevice(view, worldX, 0).x / dpr,
    toScreenY: (worldY) => worldToDevice(view, 0, worldY).y / dpr,
    viewportWorldWidth: canvasW / zoom,
    viewportWorldHeight: canvasH / zoom,
    toWorldLength: (cssPx) => (cssPx * dpr) / zoom,
  };
}

/** The map's rectangle in CSS px within the overlay container, from the same projection that
 *  positions the labels, so a layer sized to the map moves with it frame for frame. */
export function mapRectCss(
  project: OverlayProjection,
  layout: { cols: number; rows: number },
): { left: number; top: number; width: number; height: number } {
  const left = project.toScreenX(0);
  const top = project.toScreenY(0);
  return {
    left,
    top,
    width: project.toScreenX(layout.cols * TILE_SIZE) - left,
    height: project.toScreenY(layout.rows * TILE_SIZE) - top,
  };
}
