import { describe, expect, it } from 'vitest';

import {
  applyXpEvent,
  isShipCommand,
  levelForXp,
  moodFor,
  newXpTurnState,
  type XpEvent,
  type XpMember,
} from '../src/xp.js';

/** Run events in order against one member, applying each change the way the roster does. */
function play(events: XpEvent[], start: Partial<XpMember> = {}) {
  const member: XpMember = { xp: 0, streak: 0, consecutiveFailures: 0, ...start };
  const turn = newXpTurnState();
  const deltas: number[] = [];
  for (const event of events) {
    const result = applyXpEvent(member, turn, event);
    deltas.push(result.xpDelta);
    member.xp += result.change.xp ?? 0;
    if (result.change.streak !== undefined) member.streak = result.change.streak;
    if (result.change.consecutiveFailures !== undefined) {
      member.consecutiveFailures = result.change.consecutiveFailures;
    }
  }
  return { member, deltas };
}

const tool = (ships = false): XpEvent[] => [{ kind: 'toolStart', ships }, { kind: 'toolEnd' }];

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
  it('a clean tool turn pays 50 + 25 + a streak bonus capped at 50', () => {
    const bonuses: number[] = [];
    let member: Partial<XpMember> = {};
    for (let i = 1; i <= 7; i++) {
      const { member: after, deltas } = play([...tool(), { kind: 'turnEnd' }], member);
      bonuses.push(deltas[2] - 75);
      member = { streak: after.streak };
    }
    expect(bonuses).toEqual([10, 20, 30, 40, 50, 50, 50]);
  });

  it('a failed tool makes the turn pay 50 and resets the streak', () => {
    const { member, deltas } = play(
      [
        { kind: 'toolStart' },
        { kind: 'toolEnd', failed: true },
        { kind: 'toolStart' },
        { kind: 'toolEnd' },
        { kind: 'turnEnd' },
      ],
      { streak: 4 },
    );
    expect(deltas[4]).toBe(50);
    expect(member.streak).toBe(0);
  });

  it('a text-only turn pays 10 and leaves the streak alone', () => {
    const { member, deltas } = play([{ kind: 'turnEnd' }], { streak: 2 });
    expect(deltas).toEqual([10]);
    expect(member.streak).toBe(2);
  });

  it('idle_prompt (awaitingInput) pays nothing and keeps the turn open', () => {
    const { deltas } = play([
      { kind: 'toolStart' },
      { kind: 'toolEnd' },
      { kind: 'turnEnd', awaitingInput: true },
      { kind: 'turnEnd' },
    ]);
    expect(deltas).toEqual([0, 0, 0, 85]);
  });

  it('a finished sub-agent pays 15', () => {
    expect(play([{ kind: 'subagentEnd' }]).deltas).toEqual([15]);
  });

  it('a ship pays 100 when the tool succeeds, not when it starts, and not when it fails', () => {
    expect(play(tool(true)).deltas).toEqual([0, 100]);
    expect(
      play([
        { kind: 'toolStart', ships: true },
        { kind: 'toolEnd', failed: true },
      ]).deltas,
    ).toEqual([0, 0]);
  });

  it('two ships in one turn pay once, and the next turn can ship again', () => {
    const { deltas } = play([...tool(true), ...tool(true), { kind: 'turnEnd' }, ...tool(true)]);
    expect(deltas).toEqual([0, 100, 0, 0, 85, 0, 100]);
  });

  it('counts consecutive failed tools and clears them on a success', () => {
    const { member } = play([
      { kind: 'toolEnd', failed: true },
      { kind: 'toolEnd', failed: true },
      { kind: 'toolEnd', failed: true },
    ]);
    expect(member.consecutiveFailures).toBe(3);
    expect(play([{ kind: 'toolEnd' }], { consecutiveFailures: 3 }).member.consecutiveFailures).toBe(
      0,
    );
  });

  it('reports the level reached when an award crosses a threshold', () => {
    const result = applyXpEvent({ xp: 95, streak: 0, consecutiveFailures: 0 }, newXpTurnState(), {
      kind: 'subagentEnd',
    });
    expect(result.levelUp).toBe(2);
  });
});

describe('isShipCommand', () => {
  it.each([
    ['git commit -m "x"', true],
    ['git -C repo commit -m x', true],
    ['git -c user.name=a commit', true],
    ['FOO=1 git commit', true],
    ['git add . && git commit -m x', true],
    ['gh pr create --fill', true],
    ['echo "git commit"', false],
    ['git status', false],
    ['git log --grep commit', false],
    ['cat notes; echo gh pr create', false],
  ])('%s -> %s', (command, ships) => {
    expect(isShipCommand(command)).toBe(ships);
  });
});

describe('moodFor', () => {
  it('ranks an alarm over failures over a streak', () => {
    const all = { tripwire: true, consecutiveFailures: 3, streak: 3 };
    expect(moodFor(all)).toBe('alarmed');
    expect(moodFor({ ...all, tripwire: false })).toBe('frustrated');
    expect(moodFor({ ...all, tripwire: false, consecutiveFailures: 2 })).toBe('happy');
    expect(moodFor({ tripwire: false, consecutiveFailures: 2, streak: 2 })).toBe('neutral');
  });
});
