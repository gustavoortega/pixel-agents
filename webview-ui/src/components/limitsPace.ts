import type { LimitWindow, UsageLimits } from '../../../core/src/messages.js';

/**
 * Pure view-model for Claude Code's official 5-hour and weekly limits, with the pace rules of the status line it
 * reads them from: where this pace lands at reset, when it runs out, and which color that earns. DOM-free so every
 * rule is a table test; the Usage panel and the HUD only lay out what these return. The server derives nothing.
 */

export type LimitKey = 'fiveHour' | 'sevenDay';
export type LimitTone = 'red' | 'yellow' | 'green';

/** Window lengths, ms. */
export const LIMIT_WINDOW_MS: Record<LimitKey, number> = {
  fiveHour: 18_000_000,
  sevenDay: 604_800_000,
};
/** Window names as the status line prints them. */
const LIMIT_LABEL: Record<LimitKey, string> = { fiveHour: '5h', sevenDay: '7d' };
/** A reading older than this is stale: still shown until its reset, dimmed and aged. */
const LIMITS_FRESH_MS = 10 * 60_000;
/** Before this fraction of the window has passed the pace swings wildly: no projection. */
const PACE_MIN_ELAPSED = 0.05;
const PROJECTION_DISPLAY_CAP = 999;
/** Used at or above this is red whatever the pace; a projection at or above it is yellow. */
const LIMIT_WARN_PCT = 80;
const LIMIT_FULL_PCT = 100;

/** The same three tones the Usage panel's budget figures use. */
export const LIMIT_TONE_CLASS: Record<LimitTone, string> = {
  red: 'text-ink-bar-over',
  yellow: 'text-ink-bar',
  green: 'text-ink-muted',
};

/** '2d23h', '4h05m', '37m', '<1m'. Units are truncated, never rounded up. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h${String(totalMinutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(totalHours / 24)}d${totalHours % 24}h`;
}

export interface LimitPace {
  /** Fraction of the window elapsed when the reading was taken, 0..1. */
  elapsed: number;
  /** Used % at reset if this pace holds; absent early in the window or with nothing used. */
  projection?: number;
  /** From the reading until 100 % at this pace, ms; only when the projection passes 100 %. */
  runoutMs?: number;
  tone: LimitTone;
}

/**
 * Pace at the moment of the reading (`receivedAt`), not now: deterministic, and still right when the reading is
 * stale. Colors compare the rounded figures the panel prints, so "80%" is never shown green.
 */
export function limitPace(window: LimitWindow, receivedAt: number, key: LimitKey): LimitPace {
  const span = LIMIT_WINDOW_MS[key];
  const used = window.usedPercentage;
  const elapsed = Math.min(1, Math.max(0, 1 - (window.resetsAt - receivedAt) / span));
  const projection = elapsed >= PACE_MIN_ELAPSED && used > 0 ? used / elapsed : undefined;
  const shownUsed = Math.round(used);
  const shownProjection = projection === undefined ? undefined : Math.round(projection);
  const over = shownProjection !== undefined && shownProjection > LIMIT_FULL_PCT;
  const tone: LimitTone =
    over || shownUsed >= LIMIT_WARN_PCT
      ? 'red'
      : shownProjection !== undefined && shownProjection >= LIMIT_WARN_PCT
        ? 'yellow'
        : 'green';
  return {
    elapsed,
    ...(projection !== undefined && { projection }),
    // Clamped at 0 like the status line: an overdrawn window never formats a negative duration.
    ...(over && { runoutMs: Math.max(0, ((LIMIT_FULL_PCT - used) * elapsed * span) / used) }),
    tone,
  };
}

/** The window if a reading exists and its reset is still ahead; absent otherwise (never a 0). */
export function liveWindow(
  limits: UsageLimits | null,
  key: LimitKey,
  now: number,
): LimitWindow | null {
  const window = limits?.[key] ?? null;
  return window !== null && window.resetsAt > now ? window : null;
}

function isReached(window: LimitWindow): boolean {
  return window.usedPercentage >= LIMIT_FULL_PCT;
}

export interface OfficialRow {
  /** 'Official · 37% used · resets in 2h13m', plus ' · 23m ago' when stale. Shown in `tone`, as the status line
   *  colors its whole window part. */
  text: string;
  tone: LimitTone;
  stale: boolean;
  /** 'on pace for 120%'; absent early in the window, with nothing used, or once the limit is reached. */
  pace?: string;
}

export function officialRow(
  limits: UsageLimits | null,
  key: LimitKey,
  now: number,
): OfficialRow | null {
  const window = liveWindow(limits, key, now);
  if (window === null || limits === null) return null;
  const pace = limitPace(window, limits.receivedAt, key);
  const stale = now - limits.receivedAt >= LIMITS_FRESH_MS;
  const age = stale ? ` · ${formatDuration(now - limits.receivedAt)} ago` : '';
  return {
    text: `Official · ${Math.round(window.usedPercentage)}% used · resets in ${formatDuration(window.resetsAt - now)}${age}`,
    tone: pace.tone,
    stale,
    ...(pace.projection !== undefined &&
      !isReached(window) && {
        pace: `on pace for ${Math.min(PROJECTION_DISPLAY_CAP, Math.round(pace.projection))}%`,
      }),
  };
}

/** At most one nudge, the weekly window first (it blocks longer): its limit reached, or its pace running out
 *  before the reset. Then the same for the 5-hour window. */
export function limitsNudge(limits: UsageLimits | null, now: number): string | null {
  if (limits === null) return null;
  for (const key of ['sevenDay', 'fiveHour'] as const) {
    const window = liveWindow(limits, key, now);
    if (window === null) continue;
    if (isReached(window)) {
      return `the ${LIMIT_LABEL[key]} limit is reached: resets in ${formatDuration(window.resetsAt - now)}`;
    }
    const { runoutMs } = limitPace(window, limits.receivedAt, key);
    if (runoutMs !== undefined) {
      return `at this pace the ${LIMIT_LABEL[key]} window runs out in ${formatDuration(runoutMs)}, before reset: slow down or use a cheaper model`;
    }
  }
  return null;
}

/** Whether neither window has a live reading: nothing received, both past their reset, or both dropped. */
export function noLiveLimits(limits: UsageLimits | null, now: number): boolean {
  return (
    liveWindow(limits, 'fiveHour', now) === null && liveWindow(limits, 'sevenDay', now) === null
  );
}

export interface HudLimit {
  key: LimitKey;
  /** '5h 37%' */
  text: string;
  tone: LimitTone;
}

/** The HUD's one line, '5h 37% · 7d 12%': live windows only, empty when there is none. */
export function hudLimits(limits: UsageLimits | null, now: number): HudLimit[] {
  if (limits === null) return [];
  return (['fiveHour', 'sevenDay'] as const).flatMap((key) => {
    const window = liveWindow(limits, key, now);
    if (window === null) return [];
    const { tone } = limitPace(window, limits.receivedAt, key);
    return [{ key, text: `${LIMIT_LABEL[key]} ${Math.round(window.usedPercentage)}%`, tone }];
  });
}
