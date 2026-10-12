import {
  FX_LEVEL_UP_MS,
  FX_LEVEL_UP_QUEUE_MAX,
  FX_MAX_CONCURRENT,
  FX_POP_MS,
} from '../../constants.js';
import type { RosterEventInfo } from '../toolUtils.js';
import { shouldShowXpPop } from '../toolUtils.js';

/**
 * XP pops and level-ups: what plays, how many at once, what waits. Pure state over an injected
 * clock; drawing lives in fxRender.ts and the DOM text in ToolOverlay.
 */

export interface ActiveFx {
  kind: 'pop' | 'levelUp';
  agentId: number;
  startedAt: number;
  /** Pop only. */
  amount: number;
  /** Pop only: the work the XP paid for, which the pop names. */
  signal?: RosterEventInfo['signal'];
  /** Level-up only. */
  level: number;
}

interface QueuedLevelUp {
  agentId: number;
  level: number;
}

export class FxEngine {
  active: ActiveFx[] = [];
  /** Oldest first. One entry per agent: a newer level-up for a queued agent just updates its level. */
  queue: QueuedLevelUp[] = [];
  /** Clock of the last tick, so the DOM text ages against the same time as the engine. */
  now = 0;
  private lastPopAt = new Map<number, number>();

  onRosterEvent(agentId: number, event: RosterEventInfo & { level?: number }, now: number): void {
    if (event.kind === 'levelUp') {
      this.levelUp(agentId, event.level ?? 0, now);
      return;
    }
    // Over budget a pop is dropped, not queued: it would play late and the cooldown already throttles it.
    if (!shouldShowXpPop(event, this.lastPopAt.get(agentId), now)) return;
    if (this.active.length >= FX_MAX_CONCURRENT) return;
    this.lastPopAt.set(agentId, now);
    this.active.push({
      kind: 'pop',
      agentId,
      startedAt: now,
      amount: event.amount ?? 0,
      signal: event.signal,
      level: 0,
    });
  }

  private levelUp(agentId: number, level: number, now: number): void {
    const busy = this.active.some((a) => a.kind === 'levelUp' && a.agentId === agentId);
    const waiting = this.queue.find((q) => q.agentId === agentId);
    if (waiting) {
      waiting.level = level;
      return;
    }
    if (!busy && this.active.length < FX_MAX_CONCURRENT) {
      this.active.push({ kind: 'levelUp', agentId, startedAt: now, amount: 0, level });
      return;
    }
    this.queue.push({ agentId, level });
    if (this.queue.length > FX_LEVEL_UP_QUEUE_MAX) this.queue.shift();
  }

  /** Retire finished effects, then start queued level-ups into the free slots. */
  tick(now: number): void {
    this.now = now;
    this.active = this.active.filter((a) => now - a.startedAt < durationOf(a));
    for (let i = 0; i < this.queue.length && this.active.length < FX_MAX_CONCURRENT;) {
      const q = this.queue[i];
      if (this.active.some((a) => a.kind === 'levelUp' && a.agentId === q.agentId)) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this.active.push({
        kind: 'levelUp',
        agentId: q.agentId,
        startedAt: now,
        amount: 0,
        level: q.level,
      });
    }
  }

  forget(agentId: number): void {
    this.active = this.active.filter((a) => a.agentId !== agentId);
    this.queue = this.queue.filter((q) => q.agentId !== agentId);
    this.lastPopAt.delete(agentId);
  }
}

export function durationOf(a: Pick<ActiveFx, 'kind'>): number {
  return a.kind === 'levelUp' ? FX_LEVEL_UP_MS : FX_POP_MS;
}
