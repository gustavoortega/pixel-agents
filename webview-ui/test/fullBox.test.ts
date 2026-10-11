/**
 * The roster rows of the hover/selected box.
 */
import { describe, expect, it } from 'vitest';

import { fullBoxRows } from '../src/office/fullBox.js';
import type { AgentRosterInfo } from '../src/office/toolUtils.js';

const roster: AgentRosterInfo = {
  memberId: 'm1',
  name: 'Luna',
  level: 15,
  xp: 30,
  xpToNext: 120,
  streak: 3,
  mood: 'happy',
};

describe('fullBoxRows', () => {
  it('name, level, xp fraction, streak, mood, model in its rarity', () => {
    expect(fullBoxRows({ roster, model: { id: 'claude-opus-4', rarity: 'epic' } })).toEqual([
      { kind: 'name', text: 'Luna' },
      { kind: 'level', text: 'Lv 15' },
      { kind: 'xp', fraction: 0.25, text: '30/120' },
      { kind: 'streak', count: 3 },
      { kind: 'mood', mood: 'happy' },
      { kind: 'model', text: 'claude-opus-4', rarity: 'epic' },
    ]);
  });

  it('an unknown model gets no model row', () => {
    const rows = fullBoxRows({ roster, model: { id: 'mystery-1' } });
    expect(rows.some((r) => r.kind === 'model')).toBe(false);
    expect(rows).toHaveLength(5);
  });

  it('no streak row at zero', () => {
    const rows = fullBoxRows({ roster: { ...roster, streak: 0 } });
    expect(rows.some((r) => r.kind === 'streak')).toBe(false);
  });

  it('no roster and no model: nothing', () => {
    expect(fullBoxRows({})).toEqual([]);
  });
});
