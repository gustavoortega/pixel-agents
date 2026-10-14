/**
 * The render loop's scheduling, on a virtual clock: a quiet office steps the world on a timer and
 * draws rarely, a wake draws on the next animation frame, active drawing is capped, and a failing
 * overlay never stops the canvas.
 *
 * Run with: npm test
 */
import { describe, expect, it, vi } from 'vitest';

import {
  ACTIVE_FPS_CAP,
  ACTIVE_LINGER_MS,
  IDLE_REDRAW_MS,
  IDLE_STEP_SEC,
  IDLE_TICK_MS,
} from '../src/constants.js';
import {
  type ActivityLevel,
  onFrame,
  type Scheduler,
  startGameLoop,
} from '../src/office/engine/gameLoop.js';

/** An animation frame arrives this long after it is requested. */
const FRAME_MS = 16;

/**
 * A virtual clock. raf(cb) fires FRAME_MS after the request, a timeout at its due time, and
 * advance(ms) fires everything due by the end of the span (the end included) in time order.
 */
class FakeScheduler implements Scheduler {
  private t = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { due: number; cb: () => void; raf: boolean }>();

  now = (): number => this.t;
  raf = (cb: () => void): number => this.add(FRAME_MS, cb, true);
  caf = (id: number): void => {
    this.pending.delete(id);
  };
  setTimeout = (cb: () => void, ms: number): number => this.add(ms, cb, false);
  clearTimeout = (id: number): void => {
    this.pending.delete(id);
  };

  get pendingRafs(): number {
    return [...this.pending.values()].filter((p) => p.raf).length;
  }

  get pendingTimeouts(): number {
    return [...this.pending.values()].filter((p) => !p.raf).length;
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let nextId = -1;
      let next: { due: number; cb: () => void } | null = null;
      // Ids grow with every request, so the first found among equal due times was asked for first.
      for (const [id, p] of this.pending) {
        if (p.due <= end && (!next || p.due < next.due)) {
          nextId = id;
          next = p;
        }
      }
      if (!next) break;
      this.pending.delete(nextId);
      this.t = next.due;
      next.cb();
    }
    this.t = end;
  }

  private add(ms: number, cb: () => void, raf: boolean): number {
    const id = this.nextId++;
    this.pending.set(id, { due: this.t + ms, cb, raf });
    return id;
  }
}

function startOn(activity: ActivityLevel | (() => ActivityLevel)) {
  const scheduler = new FakeScheduler();
  const update = vi.fn<(dt: number) => void>();
  const render = vi.fn();
  const read = typeof activity === 'function' ? activity : () => activity;
  const loop = startGameLoop(update, render, { activity: read, scheduler });
  return { scheduler, update, render, loop };
}

/** Run until start's own linger is over and the loop waits on its timer alone. */
function settle(scheduler: FakeScheduler): void {
  for (let i = 0; i < 1000; i++) {
    if (scheduler.pendingRafs === 0 && scheduler.pendingTimeouts === 1) return;
    scheduler.advance(FRAME_MS);
  }
  throw new Error('the loop never settled on its timer');
}

describe('render loop scheduling', () => {
  it('a quiet office steps the world every tick at wall rate and draws once a second', () => {
    const { scheduler, update, render } = startOn('idle');
    settle(scheduler);
    const updates = update.mock.calls.length;
    const renders = render.mock.calls.length;

    scheduler.advance(3000);

    // 30 fixed steps: 3 s of simulated time for 3 s of wall time.
    const steps = update.mock.calls.slice(updates).map(([dt]) => dt);
    expect(steps).toEqual(new Array<number>(3000 / IDLE_TICK_MS).fill(IDLE_STEP_SEC));
    expect(render.mock.calls.length - renders).toBe(3);
  });

  it('a wake leaves the timer for the next animation frame, draws on it, and returns once the linger ends', () => {
    const { scheduler, update, render, loop } = startOn('idle');
    settle(scheduler);
    const updates = update.mock.calls.length;
    const renders = render.mock.calls.length;

    loop.wake();
    expect(scheduler.pendingTimeouts).toBe(0);
    expect(scheduler.pendingRafs).toBe(1);

    scheduler.advance(FRAME_MS);
    expect(update.mock.calls.length - updates).toBe(1);
    expect(render.mock.calls.length - renders).toBe(1);

    scheduler.advance(ACTIVE_LINGER_MS + 50 - FRAME_MS);
    expect(scheduler.pendingRafs).toBe(0);
    expect(scheduler.pendingTimeouts).toBe(1);
  });

  it('an office where only slow loops run draws every tick', () => {
    const { scheduler, render } = startOn('ambient');
    settle(scheduler);
    const renders = render.mock.calls.length;

    scheduler.advance(3000);

    expect(render.mock.calls.length - renders).toBe(3000 / IDLE_TICK_MS);
  });

  it('the tick that leaves the office still draws it, then waits for the idle redraw', () => {
    let level: ActivityLevel = 'ambient';
    const { scheduler, render } = startOn(() => level);
    settle(scheduler);
    const renders = render.mock.calls.length;

    // The next tick's update ends the last slow loop: a heart bubble fades out, a pet falls asleep.
    level = 'idle';
    scheduler.advance(IDLE_TICK_MS);
    expect(render.mock.calls.length - renders).toBe(1);

    scheduler.advance(IDLE_REDRAW_MS / 2);
    expect(render.mock.calls.length - renders).toBe(1);
  });

  it('while something moves it draws at most ACTIVE_FPS_CAP frames a second', () => {
    const { scheduler, render } = startOn('active');
    scheduler.advance(1000);
    expect(render.mock.calls.length).toBeGreaterThan(0);
    expect(render.mock.calls.length).toBeLessThanOrEqual(ACTIVE_FPS_CAP);
  });

  it('while something moves it never drops to the timer', () => {
    const { scheduler } = startOn('active');
    for (let t = 0; t < 2000; t += FRAME_MS) {
      scheduler.advance(FRAME_MS);
      expect([scheduler.pendingRafs, scheduler.pendingTimeouts]).toEqual([1, 0]);
    }
  });

  it('a pointer moving over a busy office neither lifts the cap nor stacks frame requests', () => {
    const { scheduler, render, loop } = startOn('active');
    // A mousemove wakes the loop between two frames, every half frame.
    for (let t = 0; t < 1000; t += FRAME_MS / 2) {
      scheduler.advance(FRAME_MS / 2);
      loop.wake();
    }
    expect(render.mock.calls.length).toBeLessThanOrEqual(ACTIVE_FPS_CAP);
    expect(scheduler.pendingRafs).toBe(1);
  });

  it('an overlay whose frame callback throws is dropped and the canvas keeps drawing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let failing = 0;
    let healthy = 0;
    const offFailing = onFrame(() => {
      failing++;
      throw new Error('overlay failed');
    });
    const offHealthy = onFrame(() => healthy++);
    try {
      const { scheduler, render } = startOn('active');
      scheduler.advance(500);
      expect(render.mock.calls.length).toBeGreaterThan(1);
      expect(failing).toBe(1);
      expect(healthy).toBe(render.mock.calls.length);
    } finally {
      offFailing();
      offHealthy();
      error.mockRestore();
    }
  });

  it('hidden it waits on nothing; shown again it draws on the next frame', () => {
    const { scheduler, render, loop } = startOn('ambient');
    settle(scheduler);

    loop.setVisible(false);
    expect(scheduler.pendingRafs + scheduler.pendingTimeouts).toBe(0);
    const renders = render.mock.calls.length;
    scheduler.advance(5000);
    expect(render.mock.calls.length).toBe(renders);

    loop.setVisible(true);
    expect(scheduler.pendingRafs).toBe(1);
    scheduler.advance(FRAME_MS);
    expect(render.mock.calls.length).toBe(renders + 1);
  });
});
