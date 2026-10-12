import { describe, expect, it } from 'vitest';

import { applyXpEvent, levelForXp, moodFor, type XpEvent, type XpMember } from '../src/xp.js';

/** Run events in order against one member, applying each change the way the roster does. */
function play(events: XpEvent[], start: Partial<XpMember> = {}) {
  const member: XpMember = { xp: 0, streak: 0, consecutiveFailures: 0, ...start };
  const deltas: number[] = [];
  for (const event of events) {
    const result = applyXpEvent(member, event);
    deltas.push(result.xpDelta);
    member.xp += result.change.xp ?? 0;
    if (result.change.streak !== undefined) member.streak = result.change.streak;
    if (result.change.consecutiveFailures !== undefined) {
      member.consecutiveFailures = result.change.consecutiveFailures;
    }
  }
  return { member, deltas };
}

describe('levelForXp', () => {
  it.each([
    [0, 1, 0, 100],
    [99, 1, 99, 100],
    [100, 2, 0, 283],
    [100 + 283, 3, 0, 520],
    [100 + 282, 2, 282, 283],
  ])('%i xp -> level %i', (xp, level, into, span) => {
    expect(levelForXp(xp)).toEqual({ level, xpIntoLevel: into, xpToNext: span });
  });
});

describe('applyXpEvent', () => {
  it('counts consecutive failed tools and clears them on a success', () => {
    const { member } = play([
      { type: 'toolEnd', failed: true },
      { type: 'toolEnd', failed: true },
      { type: 'toolEnd', failed: true },
    ]);
    expect(member.consecutiveFailures).toBe(3);
    expect(play([{ type: 'toolEnd' }], { consecutiveFailures: 3 }).member.consecutiveFailures).toBe(
      0,
    );
  });

  it('reports the level reached when an award crosses a threshold', () => {
    const result = applyXpEvent(
      { xp: 95, streak: 0, consecutiveFailures: 0 },
      { type: 'signal', signal: 'tests' },
    );
    expect(result.levelUp).toBe(2);
  });
});

describe('moodFor', () => {
  it('ranks an alarm over failures over work done since the last failure', () => {
    const all = { tripwire: true, consecutiveFailures: 3, streak: 1 };
    expect(moodFor(all)).toBe('alarmed');
    expect(moodFor({ ...all, tripwire: false })).toBe('frustrated');
    expect(moodFor({ ...all, tripwire: false, consecutiveFailures: 2 })).toBe('happy');
    expect(moodFor({ tripwire: false, consecutiveFailures: 2, streak: 0 })).toBe('neutral');
  });
});
