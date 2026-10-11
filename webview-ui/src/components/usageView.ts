import type { TokenAreaTotal, TokenSessionTotal, TokenWindow } from '../../../core/src/messages.js';

/**
 * Pure view-model helpers for the Usage panel and the room-sign bars. DOM-free so every rule is a table test; the
 * panel only lays out what these return.
 */

export type UsageMetric = 'weighted' | 'raw';

export const LOBBY_LABEL = 'Lobby';
const TOP_MODEL_CHIPS = 3;

export function metricOf(x: { total: number; raw: number }, metric: UsageMetric): number {
  return metric === 'raw' ? x.raw : x.total;
}

/** 0 -> "0", 999 -> "999", 1234 -> "1.2k", 1.5e6 -> "1.5M", 2.3e9 -> "2.3B". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const units: Array<[number, string]> = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [size, suffix] of units) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${suffix}`;
    }
  }
  return String(Math.round(n));
}

/** A fraction as a whole percent; anything that rounds to 0 but is not 0 reads "<1%". */
export function formatPct(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return '0%';
  const pct = Math.round(fraction * 100);
  return pct === 0 ? '<1%' : `${pct}%`;
}

export interface AreaBar {
  key: string;
  name: string;
  /** Not mapped to an Area: listed under the Lobby. */
  lobby: boolean;
  value: number;
  /** Share of the window under this metric; 0 when the window is empty. */
  share: number;
  budgetPct?: number;
}

/** One bar per area, biggest first under the chosen metric. */
export function areaBars(window: TokenWindow, metric: UsageMetric): AreaBar[] {
  const grand = metricOf(window, metric);
  return window.byArea
    .map((a: TokenAreaTotal): AreaBar => {
      const value = metricOf(a, metric);
      return {
        key: a.area === null ? `folder:${a.folder}` : `area:${a.area}`,
        name: a.area ?? a.folder,
        lobby: a.area === null,
        value,
        share: grand > 0 ? value / grand : 0,
        ...(a.budgetPct !== undefined && { budgetPct: a.budgetPct }),
      };
    })
    .sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1));
}

/** The "Eating the most" headline: the biggest bar, or null when nothing was spent. */
export function leader(window: TokenWindow, metric: UsageMetric): AreaBar | null {
  const top = areaBars(window, metric)[0];
  return top && top.value > 0 ? top : null;
}

/** Share of the window per ASSIGNED Area label, for the thin bar on each room sign. Lobby folders have no sign. */
export function areaShares(window: TokenWindow | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!window || window.total <= 0) return out;
  for (const a of window.byArea) {
    if (a.area !== null && a.total > 0) out.set(a.area, a.total / window.total);
  }
  return out;
}

export function shortModel(model: string): string {
  return model.replace(/^claude-/, '');
}

export interface ModelChip {
  model: string;
  label: string;
  value: number;
}

/** The session's heaviest models by weighted total, for the chips beside its name. */
export function modelChips(session: TokenSessionTotal): ModelChip[] {
  return Object.entries(session.models)
    .sort(([ka, a], [kb, b]) => b - a || (ka < kb ? -1 : 1))
    .slice(0, TOP_MODEL_CHIPS)
    .map(([model, value]) => ({ model, label: shortModel(model), value }));
}

/** Tooltip text: raw counters per model, one line each. */
export function modelTooltip(session: TokenSessionTotal): string {
  return Object.entries(session.rawModels)
    .sort(([ka], [kb]) => (ka < kb ? -1 : 1))
    .map(([model, [input, cacheWrite, cacheRead, output]]) => {
      return `${shortModel(model)}: in ${formatTokens(input)} / cache write ${formatTokens(cacheWrite)} / cache read ${formatTokens(cacheRead)} / out ${formatTokens(output)}`;
    })
    .join('\n');
}

/** Estimated windows say so; quota windows name the reset the CLI reported. */
export function windowCaption(window: TokenWindow): string {
  if (window.source === 'estimated') return 'estimated window';
  const reset = new Date(window.end);
  const hh = String(reset.getHours()).padStart(2, '0');
  const mm = String(reset.getMinutes()).padStart(2, '0');
  return `resets ${hh}:${mm}`;
}
