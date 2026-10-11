import type { Rarity } from './flair/modelFlair.js';
import type { AgentRosterInfo } from './toolUtils.js';

/** The rows of the hover/selected box that come from the roster and the model. */
export type FullBoxRow =
  | { kind: 'name'; text: string }
  | { kind: 'level'; text: string }
  | { kind: 'xp'; fraction: number; text: string }
  | { kind: 'streak'; count: number }
  | { kind: 'mood'; mood: AgentRosterInfo['mood'] }
  | { kind: 'model'; text: string; rarity: Rarity };

export function fullBoxRows(state: {
  roster?: AgentRosterInfo;
  /** Model id with its rarity; rarity is absent for a model the provider cannot place. */
  model?: { id: string; rarity?: Rarity };
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
  return rows;
}
