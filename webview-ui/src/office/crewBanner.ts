/**
 * The crew banner: one per running workflow run, hung above the mean position of the lead's drawn
 * helpers. It names the run (`Workflow` when the server does not know the name), its lead, its
 * phases (a pip per started agent, filled once done; the newest phase lit) and its counts. Pure:
 * the overlay sizes and places it before the label pass, so plates keep clear of it.
 */

import {
  CREW_BANNER_BORDER_PX,
  CREW_BANNER_CHIP_FONT_PX,
  CREW_BANNER_COUNT_FONT_PX,
  CREW_BANNER_GAP_PX,
  CREW_BANNER_LABEL_FONT_PX,
  CREW_BANNER_MAX_PIPS,
  CREW_BANNER_NAME_FONT_PX,
  CREW_BANNER_PAD_X_PX,
  CREW_BANNER_PAD_Y_PX,
  CREW_BANNER_PIP_PX,
  CREW_BANNER_ROW1_PX,
  CREW_BANNER_ROW2_PX,
  CREW_BANNER_ROW3_PX,
} from '../constants.js';
import type { WorkflowRunView } from './engine/officeState.js';
import type { Rect } from './labelLayout.js';
import { pixelTextWidth } from './nameplate.js';
import { formatSpan } from './plateState.js';

/** The banner's label row text when the run has a name. */
export const CREW_BANNER_LABEL = 'WORKFLOW';
/** Shown instead of the name when the server does not know it (after a restart). */
export const CREW_BANNER_FALLBACK_NAME = 'Workflow';

export interface CrewBannerPhase {
  name: string;
  /** Pips drawn: one per started agent, capped; `more` counts the rest. */
  pips: number;
  filled: number;
  more: number;
  newest: boolean;
}

export interface CrewBannerView {
  /** The run's name, or the fallback (then the WORKFLOW label is left out: it would repeat it). */
  title: string;
  named: boolean;
  lead: string;
  phases: CrewBannerPhase[];
  /** `4 started · 1 done · 21m`, each part only when known; null when none is. */
  counts: string | null;
}

export function crewBannerView(run: WorkflowRunView, lead: string, now: number): CrewBannerView {
  const phases = (run.phases ?? []).map((p, i, all) => {
    const started = Math.max(0, p.started ?? 0);
    const done = Math.min(started, Math.max(0, p.done ?? 0));
    const pips = Math.min(started, CREW_BANNER_MAX_PIPS);
    return {
      name: p.name ?? '',
      pips,
      filled: Math.min(done, pips),
      more: started - pips,
      newest: i === all.length - 1,
    };
  });
  const parts: string[] = [];
  if (run.started !== undefined) parts.push(`${run.started} started`);
  if (run.done !== undefined) parts.push(`${run.done} done`);
  if (run.since !== undefined) parts.push(formatSpan(now - run.since));
  return {
    title: run.name || CREW_BANNER_FALLBACK_NAME,
    named: !!run.name,
    lead,
    phases,
    counts: parts.length > 0 ? parts.join(' · ') : null,
  };
}

const CHIP_PAD_X = 5;
const CHIP_BORDER = 2;
const PIP_GAP = 2;
const ITEM_GAP = 6;

/** Width of one phase chip, CSS px. */
export function crewChipWidth(p: CrewBannerPhase): number {
  const pips = p.pips > 0 ? ITEM_GAP / 2 + p.pips * (CREW_BANNER_PIP_PX + PIP_GAP) : 0;
  const more = p.more > 0 ? pixelTextWidth(` +${p.more}`, CREW_BANNER_CHIP_FONT_PX) : 0;
  return (
    pixelTextWidth(p.name, CREW_BANNER_CHIP_FONT_PX) + pips + more + 2 * (CHIP_PAD_X + CHIP_BORDER)
  );
}

/** The banner's box at scale 1, CSS px (the hard shadow below it excluded). */
export function crewBannerSize(v: CrewBannerView): { w: number; h: number } {
  const label = v.named
    ? Math.ceil(
        pixelTextWidth(CREW_BANNER_LABEL, CREW_BANNER_LABEL_FONT_PX) +
          CREW_BANNER_LABEL.length * 0.1 * CREW_BANNER_LABEL_FONT_PX,
      ) + ITEM_GAP
    : 0;
  const row1 =
    label +
    pixelTextWidth(v.title, CREW_BANNER_NAME_FONT_PX) +
    ITEM_GAP +
    pixelTextWidth(`· ${v.lead}`, CREW_BANNER_COUNT_FONT_PX);
  const sep = pixelTextWidth('›', CREW_BANNER_CHIP_FONT_PX) + 2 * ITEM_GAP;
  const row2 = v.phases.reduce((a, p, i) => a + crewChipWidth(p) + (i > 0 ? sep : 0), 0);
  const row3 = v.counts ? pixelTextWidth(v.counts, CREW_BANNER_COUNT_FONT_PX) : 0;
  const h =
    CREW_BANNER_ROW1_PX +
    (v.phases.length > 0 ? CREW_BANNER_ROW2_PX : 0) +
    (v.counts ? CREW_BANNER_ROW3_PX : 0);
  return {
    w: Math.max(row1, row2, row3) + 2 * (CREW_BANNER_PAD_X_PX + CREW_BANNER_BORDER_PX),
    h: h + 2 * (CREW_BANNER_PAD_Y_PX + CREW_BANNER_BORDER_PX),
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Step of the search for a free spot, and how far it looks, CSS px. */
const SEARCH_STEP_PX = 6;
const SEARCH_REACH_PX = 360;
/** A sideways step costs more than a vertical one. */
const SIDEWAYS_COST = 1.5;

/** Every search offset, cheapest first, built once. */
const OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dy = -SEARCH_REACH_PX; dy <= SEARCH_REACH_PX; dy += SEARCH_STEP_PX)
    for (let dx = -SEARCH_REACH_PX; dx <= SEARCH_REACH_PX; dx += SEARCH_STEP_PX)
      out.push([dx, dy, Math.abs(dy) + SIDEWAYS_COST * Math.abs(dx)]);
  out.sort((a, b) => a[2] - b[2]);
  return out.map(([dx, dy]) => [dx, dy] as const);
})();

function inside(r: Rect, b: Rect): boolean {
  return r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
}

/**
 * Where the banner hangs, CSS px: centred over the helpers' mean x, its bottom a gap above their
 * mean head top. When that spot covers a plate or a face (`avoid`) the nearest free spot wins,
 * vertical moves before sideways ones, inside the helpers' room (`room`) before anywhere else on
 * the map (`map`). With no free spot at all it keeps the first spot, slid inside the room.
 */
export function crewBannerRect(
  size: { w: number; h: number },
  heads: ReadonlyArray<{ x: number; y: number }>,
  room: Rect | null,
  map: Rect | null = room,
  avoid: readonly Rect[] = [],
): Rect | null {
  if (heads.length === 0) return null;
  // The same office gives the same spot: a crowded room's full search runs once, not per frame.
  const key = [size, ...heads, room, map, ...avoid]
    .map((v) => (v ? Object.values(v).map(Math.round).join(',') : '-'))
    .join(';');
  const hit = rectMemo.get(key);
  if (hit !== undefined) return hit;
  const r = searchBannerRect(size, heads, room, map, avoid);
  if (rectMemo.size >= RECT_MEMO_MAX) rectMemo.clear();
  rectMemo.set(key, r);
  return r;
}

const rectMemo = new Map<string, Rect>();
const RECT_MEMO_MAX = 64;

function searchBannerRect(
  size: { w: number; h: number },
  heads: ReadonlyArray<{ x: number; y: number }>,
  room: Rect | null,
  map: Rect | null,
  avoid: readonly Rect[],
): Rect {
  const mx = heads.reduce((a, p) => a + p.x, 0) / heads.length;
  const my = heads.reduce((a, p) => a + p.y, 0) / heads.length;
  const x = Math.round(mx - size.w / 2);
  const y = Math.round(my - CREW_BANNER_GAP_PX - size.h);
  for (const within of [room, map]) {
    if (!within) continue;
    for (const [dx, dy] of OFFSETS) {
      const r = { x: x + dx, y: y + dy, w: size.w, h: size.h };
      if (inside(r, within) && !avoid.some((a) => intersects(r, a))) return r;
    }
  }
  if (!room) return { x, y, w: size.w, h: size.h };
  return {
    x: Math.max(room.x, Math.min(x, room.x + room.w - size.w)),
    y: Math.max(room.y, Math.min(y, room.y + room.h - size.h)),
    w: size.w,
    h: size.h,
  };
}

/** The run id of a crew helper's synthetic parent tool id `wf:<runId>:<agentId>`. */
export function crewRunId(parentToolId: string, prefix: string): string | null {
  if (!parentToolId.startsWith(prefix)) return null;
  const rest = parentToolId.slice(prefix.length);
  const cut = rest.lastIndexOf(':');
  return cut > 0 ? rest.slice(0, cut) : null;
}
