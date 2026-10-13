import {
  ACTIVE_FPS_CAP,
  ACTIVE_FRAME_SLACK_MS,
  ACTIVE_LINGER_MS,
  IDLE_REDRAW_MS,
  IDLE_STEP_SEC,
  IDLE_TICK_MS,
  MAX_DELTA_TIME_SEC,
  MAX_IDLE_SUBSTEPS,
} from '../../constants.js';
import { isE2E } from '../../runtime.js';

/**
 * How much of the office moves, which decides how often the loop runs. 'active': something moves
 * every frame, so the loop runs on animation frames capped at ACTIVE_FPS_CAP. 'ambient': only slow
 * loops run, so a timer steps and draws every IDLE_TICK_MS. 'idle': nothing moves, so the timer
 * still steps the world but draws once per IDLE_REDRAW_MS.
 */
export type ActivityLevel = 'active' | 'ambient' | 'idle';

/** The mode the loop last scheduled in; 'stopped' before start and after stop. */
export type LoopMode = ActivityLevel | 'stopped';

/** What a drawn frame knows: seconds since the previous draw and the loop clock in ms. */
export interface FrameInfo {
  dt: number;
  now: number;
}

/** The clock and the two ways the loop waits. Tests pass a virtual one. */
export interface Scheduler {
  /** The callback's timestamp argument is ignored: every loop time comes from `now`. */
  raf: (cb: () => void) => number;
  caf: (id: number) => void;
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  now: () => number;
}

export interface GameLoop {
  stop: () => void;
  /** Something changed: draw on the next animation frame and keep drawing for ACTIVE_LINGER_MS. */
  wake: () => void;
  /** Hidden stops every tick and keeps the mode; shown wakes. */
  setVisible: (visible: boolean) => void;
}

/** e2e counters: animation-frame requests, update() and render() calls, and the last mode. */
export interface FrameCounters {
  raf: number;
  update: number;
  render: number;
  mode: LoopMode;
}

const RANK: Readonly<Record<ActivityLevel, number>> = { idle: 0, ambient: 1, active: 2 };

/** The busier of two levels. */
export function busiest(a: ActivityLevel, b: ActivityLevel): ActivityLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

const FRAME_MIN_GAP_MS = 1000 / ACTIVE_FPS_CAP - ACTIVE_FRAME_SLACK_MS;

// Created when the module loads, so an e2e poll finds the object before the first loop starts.
const counters: FrameCounters | null = isE2E
  ? ((window.__pixelAgentsTestHooks ??= {}).frames ??= {
      raf: 0,
      update: 0,
      render: 0,
      mode: 'stopped',
    })
  : null;

// Listeners outlive loop restarts: the overlay components subscribe once, the canvas loop restarts on every zoom.
const frameListeners = new Set<(frame: FrameInfo) => void>();
let generation = 0;
let latestWake: (() => void) | null = null;

/** Run `cb` right after every drawn frame. Returns the unsubscribe. */
export function onFrame(cb: (frame: FrameInfo) => void): () => void {
  frameListeners.add(cb);
  return () => {
    frameListeners.delete(cb);
  };
}

/** Wake the most recently started loop; a no-op when none runs. For state changed outside the loop. */
export function requestRedraw(): void {
  latestWake?.();
}

function browserScheduler(): Scheduler {
  return {
    raf: (cb) => requestAnimationFrame(() => cb()),
    caf: (id) => cancelAnimationFrame(id),
    setTimeout: (cb, ms) => window.setTimeout(cb, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    now: () => performance.now(),
  };
}

/**
 * Drive `update` and `render` at the rate the office needs. After every update `activity` picks
 * the level; the loop stays on animation frames while it is 'active' and for ACTIVE_LINGER_MS after
 * the last active reading or wake, and otherwise steps on an IDLE_TICK_MS timer in fixed
 * IDLE_STEP_SEC steps, so simulated time keeps wall time in every mode: only drawing slows down.
 * Never a frame and a timer pending at once.
 */
export function startGameLoop(
  update: (dt: number) => void,
  render: (frame: FrameInfo) => void,
  opts: { activity: () => ActivityLevel; scheduler?: Scheduler },
): GameLoop {
  const s = opts.scheduler ?? browserScheduler();
  const gen = ++generation;
  let stopped = false;
  let visible = true;
  // Set while a tick runs: a wake from inside it only extends the linger, the tick schedules.
  let ticking = false;
  let rafId: number | null = null;
  let timeoutId: number | null = null;
  let lastUpdateT = s.now();
  // -Infinity lets the next frame past the cap: the frame a wake asks for always draws.
  let lastRenderT = -Infinity;
  let lastActiveAt = -Infinity;
  // The level the pending timer was set for.
  let timerLevel: ActivityLevel = 'idle';
  let acc = 0;

  const live = (): boolean => !stopped && gen === generation;
  const setMode = (mode: LoopMode): void => {
    if (counters) counters.mode = mode;
  };

  const requestFrame = (): void => {
    if (counters) counters.raf++;
    rafId = s.raf(onAnimationFrame);
  };

  const step = (dt: number): void => {
    if (counters) counters.update++;
    update(dt);
  };

  const draw = (frame: FrameInfo): void => {
    if (counters) counters.render++;
    lastRenderT = frame.now;
    render(frame);
    for (const cb of frameListeners) {
      try {
        cb(frame);
      } catch (err) {
        // Each overlay used to run a frame loop of its own, so a failing one stopped only itself.
        frameListeners.delete(cb);
        console.error('[Webview] A frame listener threw and was dropped:', err);
      }
    }
  };

  const goActive = (t: number): void => {
    lastActiveAt = t;
    lastRenderT = -Infinity;
    setMode('active');
    requestFrame();
  };

  const schedule = (t: number, level: ActivityLevel): void => {
    if (level === 'active') lastActiveAt = t;
    if (t - lastActiveAt < ACTIVE_LINGER_MS) {
      setMode('active');
      requestFrame();
      return;
    }
    setMode(level);
    timerLevel = level;
    timeoutId = s.setTimeout(onTimer, IDLE_TICK_MS);
  };

  function onAnimationFrame(): void {
    rafId = null;
    if (!live()) return;
    const t = s.now();
    if (t - lastRenderT < FRAME_MIN_GAP_MS) {
      requestFrame();
      return;
    }
    ticking = true;
    try {
      const dt = Math.min(Math.max(0, (t - lastUpdateT) / 1000), MAX_DELTA_TIME_SEC);
      lastUpdateT = t;
      acc = 0;
      step(dt);
      draw({ dt, now: t });
      schedule(t, opts.activity());
    } finally {
      ticking = false;
    }
  }

  function onTimer(): void {
    timeoutId = null;
    if (!live()) return;
    const t = s.now();
    ticking = true;
    try {
      const elapsed = Math.max(0, (t - lastUpdateT) / 1000);
      lastUpdateT = t;
      acc += Math.min(elapsed, MAX_IDLE_SUBSTEPS * IDLE_STEP_SEC);
      while (acc >= IDLE_STEP_SEC) {
        step(IDLE_STEP_SEC);
        acc -= IDLE_STEP_SEC;
      }
      const level = opts.activity();
      if (level === 'active') {
        // The next animation frame draws it; drawing here as well would only repeat that frame.
        goActive(t);
        return;
      }
      // The tick whose update quietened the office (a heart bubble gone, a pet asleep) draws that
      // change, or the last ambient frame would stay up for IDLE_REDRAW_MS.
      if (level === 'ambient' || timerLevel === 'ambient' || t - lastRenderT >= IDLE_REDRAW_MS) {
        draw({ dt: lastRenderT === -Infinity ? 0 : (t - lastRenderT) / 1000, now: t });
      }
      schedule(t, level);
    } finally {
      ticking = false;
    }
  }

  const cancelPending = (): void => {
    if (rafId !== null) s.caf(rafId);
    if (timeoutId !== null) s.clearTimeout(timeoutId);
    rafId = null;
    timeoutId = null;
  };

  const wake = (): void => {
    if (!live()) return;
    const t = s.now();
    lastActiveAt = t;
    if (!visible || ticking || rafId !== null) return;
    if (timeoutId !== null) {
      s.clearTimeout(timeoutId);
      timeoutId = null;
    }
    goActive(t);
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelPending();
    if (gen === generation) {
      generation++;
      setMode('stopped');
    }
  };

  const setVisible = (shown: boolean): void => {
    if (!live()) return;
    visible = shown;
    if (shown) wake();
    else cancelPending();
  };

  latestWake = wake;
  wake();
  return { stop, wake, setVisible };
}
