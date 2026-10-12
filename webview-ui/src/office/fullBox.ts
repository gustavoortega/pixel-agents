import { CACHE_TTL_5M_SECONDS } from '../../../core/src/constants.js';
import type { CacheTtlSeconds, PermissionMode } from '../../../core/src/messages.js';
import {
  CACHE_ROW_MIN_CONTEXT_TOKENS,
  FULL_BOX_BASE_LIFT_PX,
  FULL_BOX_EXTRA_LINES_LIFT_PX,
  FULL_BOX_ROW_PX,
  PERMISSION_MODE_ROW_TEXT,
} from '../constants.js';
import type { Rarity } from './flair/modelFlair.js';
import type { AgentRosterInfo } from './toolUtils.js';

/** The rows of the hover/selected box that come from the roster, the model and the session. */
export type FullBoxRow =
  | { kind: 'name'; text: string }
  | { kind: 'level'; text: string }
  | { kind: 'xp'; fraction: number; text: string }
  | { kind: 'streak'; count: number }
  | { kind: 'mood'; mood: AgentRosterInfo['mood'] }
  | { kind: 'model'; text: string; rarity: Rarity }
  | { kind: 'cache'; text: string }
  | { kind: 'mode'; text: string }
  | { kind: 'shells'; text: string };

/** What the server says about an agent's session (agentCache, agentMode, agentShells). */
export interface SessionSignals {
  cache?: { ttlSeconds: CacheTtlSeconds; expiresAt: number };
  mode?: PermissionMode;
  /** Background shells running; 0 or absent shows nothing. */
  shells?: number;
  contextTokens: number;
  /** Epoch ms of this render. The server sends when the cache expires, once per
   *  turn; the countdown and cold are worked out here, on every frame. */
  now: number;
}

export function fullBoxRows(state: {
  roster?: AgentRosterInfo;
  /** Model id with its rarity; rarity is absent for a model the provider cannot place. */
  model?: { id: string; rarity?: Rarity };
  /** Absent for a sub-agent, which has no session of its own. */
  signals?: SessionSignals;
}): FullBoxRow[] {
  const rows: FullBoxRow[] = [];
  const r = state.roster;
  if (r) {
    rows.push({ kind: 'name', text: r.name });
    rows.push({ kind: 'level', text: `Lv ${r.level}` });
    const fraction = r.xpToNext > 0 ? Math.min(1, Math.max(0, r.xp / r.xpToNext)) : 0;
    rows.push({ kind: 'xp', fraction, text: `${r.xp}/${r.xpToNext}` });
    if (r.streak > 0) rows.push({ kind: 'streak', count: r.streak });
    rows.push({ kind: 'mood', mood: r.mood });
  }
  // An unknown model has no rarity color to show, so it gets no row rather than a gray one.
  if (state.model?.rarity) {
    rows.push({ kind: 'model', text: state.model.id, rarity: state.model.rarity });
  }
  const s = state.signals;
  if (s) {
    const cache = cacheRowText(s);
    if (cache) rows.push({ kind: 'cache', text: cache });
    const mode =
      s.mode && Object.hasOwn(PERMISSION_MODE_ROW_TEXT, s.mode)
        ? PERMISSION_MODE_ROW_TEXT[s.mode]
        : null;
    if (mode) rows.push({ kind: 'mode', text: mode });
    const shells = s.shells ?? 0;
    if (shells > 0)
      rows.push({ kind: 'shells', text: shells === 1 ? '1 shell' : `${shells} shells` });
  }
  return rows;
}

/** "cache 59m left", "cache 42s left" or "cache cold", marked (5m) when the session
 *  moved to the short TTL. Unknown is no row, never cold. */
function cacheRowText(s: SessionSignals): string | null {
  if (!s.cache || s.contextTokens < CACHE_ROW_MIN_CONTEXT_TOKENS) return null;
  const leftMs = s.cache.expiresAt - s.now;
  let clock: string;
  if (leftMs >= 60_000) clock = `${Math.floor(leftMs / 60_000)}m left`;
  else if (leftMs > 0) clock = `${Math.floor(leftMs / 1000)}s left`;
  else clock = 'cold';
  return `cache ${clock}${s.cache.ttlSeconds === CACHE_TTL_5M_SECONDS ? ' (5m)' : ''}`;
}

/** How far above its anchor the full box's top sits: it grows downward, so every
 *  row lifts it one row pitch to keep the character clear. */
export function fullBoxTopOffsetPx(rows: readonly FullBoxRow[], hasExtraLines: boolean): number {
  return (
    (hasExtraLines ? FULL_BOX_EXTRA_LINES_LIFT_PX : FULL_BOX_BASE_LIFT_PX) +
    rows.length * FULL_BOX_ROW_PX
  );
}
