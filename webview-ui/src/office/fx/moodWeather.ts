import {
  FX_HEART_GLOBAL_GAP_MS,
  FX_HEART_MS,
  FX_HEART_REPEAT_MS,
  FX_STORM_FADE_MS,
  FX_STORM_MAX,
  FX_STORM_MS,
} from '../../constants.js';
import type { AgentRosterInfo } from '../toolUtils.js';

type Mood = AgentRosterInfo['mood'];

interface MoodState {
  mood: Mood;
  since: number;
  /** A storm slot was granted when the frustrated mood began; without one the agent stays dry. */
  stormGranted: boolean;
  /** Happy only: the next heart is due at this time. */
  nextHeartAt: number;
}

export interface Heart {
  agentId: number;
  startedAt: number;
}

/**
 * Mood weather. It is outside the FX budget (it is ambient) but capped office-wide instead: at
 * most FX_STORM_MAX storm clouds and one heart per FX_HEART_GLOBAL_GAP_MS, so a busy crew does
 * not fill the room with clouds. Alarmed has no weather: the tripwire beacon owns it.
 */
export class MoodWeather {
  private states = new Map<number, MoodState>();
  hearts: Heart[] = [];
  private lastHeartAt = -Infinity;

  /** Feed the current moods every frame; transitions are detected here. */
  update(moods: ReadonlyMap<number, Mood>, now: number): void {
    for (const id of [...this.states.keys()]) {
      if (!moods.has(id)) this.states.delete(id);
    }
    const ids = [...moods.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const mood = moods.get(id)!;
      let s = this.states.get(id);
      if (!s || s.mood !== mood) {
        s = { mood, since: now, stormGranted: false, nextHeartAt: now };
        if (mood === 'frustrated') s.stormGranted = this.activeStorms(now) < FX_STORM_MAX;
        this.states.set(id, s);
      }
      // Due, not fired: a heart held back by the office-wide gap goes out as soon as it opens.
      if (
        mood === 'happy' &&
        now >= s.nextHeartAt &&
        now - this.lastHeartAt >= FX_HEART_GLOBAL_GAP_MS
      ) {
        this.hearts.push({ agentId: id, startedAt: now });
        this.lastHeartAt = now;
        s.nextHeartAt = now + FX_HEART_REPEAT_MS;
      }
    }
    this.hearts = this.hearts.filter((h) => now - h.startedAt < FX_HEART_MS);
  }

  /** Cloud opacity for an agent, or null when it has no storm. */
  stormAlpha(agentId: number, now: number): number | null {
    const s = this.states.get(agentId);
    if (!s || s.mood !== 'frustrated' || !s.stormGranted) return null;
    const age = now - s.since;
    if (age >= FX_STORM_MS) return null;
    const left = FX_STORM_MS - age;
    return left >= FX_STORM_FADE_MS ? 1 : left / FX_STORM_FADE_MS;
  }

  /** A storm cloud or a heart is up: the rain falls and the heart rises every frame. */
  moving(now: number): boolean {
    return this.hearts.length > 0 || this.activeStorms(now) > 0;
  }

  /** Milliseconds since the storm started, for the rain loop. */
  stormAge(agentId: number, now: number): number {
    return now - (this.states.get(agentId)?.since ?? now);
  }

  private activeStorms(now: number): number {
    let n = 0;
    for (const id of this.states.keys()) if (this.stormAlpha(id, now) !== null) n++;
    return n;
  }
}
