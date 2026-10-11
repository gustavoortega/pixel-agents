import {
  MONITOR_DIM_ALPHA,
  MONITOR_DIM_COLOR,
  MONITOR_GLOW_ALPHA,
  MONITOR_GLOW_COLOR,
  MONITOR_SCANLINE_ALPHA,
  MONITOR_SCANLINE_COLOR,
} from '../../constants.js';
import { monitorOverlayPlan } from '../monitor.js';

const cache = new Map<string, HTMLCanvasElement>();

/** Glow, optional dim and scanlines for one screen, sized to the screen pixels only. Built once
 *  per (zoom, dim) and drawn over the PC sprite. */
export function getMonitorOverlay(zoom: number, dim: boolean): HTMLCanvasElement {
  const key = `${zoom}:${dim}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const { w, h, scanlineRows } = monitorOverlayPlan(zoom);
  hit = document.createElement('canvas');
  hit.width = w;
  hit.height = h;
  const ctx = hit.getContext('2d')!;
  ctx.globalAlpha = MONITOR_GLOW_ALPHA;
  ctx.fillStyle = MONITOR_GLOW_COLOR;
  ctx.fillRect(0, 0, w, h);
  if (dim) {
    ctx.globalAlpha = MONITOR_DIM_ALPHA;
    ctx.fillStyle = MONITOR_DIM_COLOR;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalAlpha = MONITOR_SCANLINE_ALPHA;
  ctx.fillStyle = MONITOR_SCANLINE_COLOR;
  for (const y of scanlineRows) ctx.fillRect(0, y, w, 1);
  cache.set(key, hit);
  return hit;
}
