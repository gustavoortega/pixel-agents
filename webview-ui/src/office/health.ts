import type { HealthReason, HealthState } from '../../../core/src/messages.js';

/** An agent's health as the server last sent it. */
export interface AgentHealthView {
  state: HealthState;
  reason: HealthReason;
  count: number;
}

/** The line the full box shows for an agent's health. The count comes from the server, so a
 *  client clock never moves it. */
export function healthLabel(health: { reason: HealthReason; count: number }): string {
  switch (health.reason) {
    case 'tests_failing_no_edits':
      return 'tests failing, no edits';
    case 'no_progress':
      return `no progress for ${health.count} min`;
    case 'same_call_repeated':
      return `same call repeated ${health.count} times`;
    case 'process_gone':
      return 'process gone';
  }
}

/** The mark drawn over the head: smoke for stuck and looping, a pause mark for stalled. A
 *  dead agent gets none; its sprite goes gray instead. */
export function healthMark(state: HealthState | undefined): 'smoke' | 'pause' | null {
  if (state === 'stuck' || state === 'looping') return 'smoke';
  if (state === 'stalled') return 'pause';
  return null;
}
