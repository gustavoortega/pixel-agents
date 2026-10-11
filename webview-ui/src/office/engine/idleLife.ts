/**
 * What an agent does with its idle time, as a pure decision plus the bookkeeping that keeps it
 * from flapping. The decision (`idlePose`) is a table over status, time idle and who can use the
 * sofas; `stepPose` decides WHEN it is asked: on a status change (non-active ones after they have
 * held for a moment) and on a slow tick, never per frame.
 */

import {
  COFFEE_MIN_IDLE_SEC,
  COFFEE_SEED_MODULUS,
  NAP_AFTER_IDLE_SEC,
  POSE_SETTLE_SEC,
  POSE_TICK_SEC,
} from '../../constants.js';
import { IdlePose, WorkStatus } from '../types.js';

/** Whether a seed (the agent id) makes a coffee drinker: 1 in COFFEE_SEED_MODULUS. */
export function isCoffeeDrinker(seed: number): boolean {
  return (Math.imul(seed | 0, 0x9e3779b1) >>> 0) % COFFEE_SEED_MODULUS === 0;
}

export interface IdlePoseInput {
  status: WorkStatus;
  /** Seconds since the agent last worked (waiting counts: the turn is over). */
  idleSec: number;
  /** Poses need a desk to sit at. */
  hasSeat: boolean;
  seed: number;
  /** A sofa seat is free and fewer than SOFA_MAX_OCCUPANTS agents are using the sofas. */
  sofaFree: boolean;
  /** The agent's own coffee cooldown has run out. */
  coffeeReady: boolean;
  /** The pose it holds now: napping is one-way within an idle span, coffee ends only on its own terms. */
  current: IdlePose;
}

/**
 * The pose for a status. Idle agents read; a coffee drinker with a free sofa and enough idle time
 * walks to it instead; after NAP_AFTER_IDLE_SEC (or once napping) the reader nods off. An agent with
 * no desk has no pose: it keeps the typing animation where it stands.
 */
export function idlePose(i: IdlePoseInput): IdlePose {
  if (i.status === WorkStatus.ACTIVE || !i.hasSeat) return IdlePose.TYPING;
  if (i.status === WorkStatus.WAITING) return IdlePose.WAIT_BUBBLE;
  if (i.current === IdlePose.COFFEE) return IdlePose.COFFEE;
  if (isCoffeeDrinker(i.seed) && i.coffeeReady && i.sofaFree && i.idleSec >= COFFEE_MIN_IDLE_SEC) {
    return IdlePose.COFFEE;
  }
  if (i.current === IdlePose.NAPPING || i.idleSec >= NAP_AFTER_IDLE_SEC) return IdlePose.NAPPING;
  return IdlePose.READING;
}

export { IdlePose, WorkStatus };

/** The slice of a character the pose bookkeeping owns. */
export interface PoseState {
  id: number;
  agentStatus: WorkStatus;
  pose: IdlePose;
  poseStatus: WorkStatus;
  idleSec: number;
  poseSettleSec: number;
  poseTickSec: number;
  poseClockSec: number;
  coffeeCooldownSec: number;
  seatId: string | null;
}

/** What `stepPose` needs from the world. */
export interface PoseEnv {
  /** The agent is on a coffee trip (walking out, sitting, or walking back): the trip owns the pose. */
  coffeeActive(): boolean;
  /** A free sofa slot exists right now. */
  sofaFree(): boolean;
  /** Called when the pose becomes `coffee`; false when the trip cannot start (no path), which keeps the agent reading. */
  startCoffee(): boolean;
}

/**
 * Advance one agent's pose clocks and re-decide the pose when it is time. Returns the pose after
 * the step. Evaluation happens when the status changed (at once for active, after POSE_SETTLE_SEC
 * for the others) and every POSE_TICK_SEC, so a status that flaps cannot flap the pose.
 */
export function stepPose(ch: PoseState, dt: number, env: PoseEnv): IdlePose {
  const working = ch.agentStatus === WorkStatus.ACTIVE;
  ch.idleSec = working ? 0 : ch.idleSec + dt;
  ch.coffeeCooldownSec = Math.max(0, ch.coffeeCooldownSec - dt);
  ch.poseClockSec += dt;
  ch.poseTickSec -= dt;
  if (env.coffeeActive()) return ch.pose;

  let evaluate = false;
  if (ch.agentStatus !== ch.poseStatus) {
    ch.poseStatus = ch.agentStatus;
    ch.poseSettleSec = 0;
    // Active is never held back: the work animation must start with the work.
    evaluate = working || POSE_SETTLE_SEC <= 0;
  } else if (!working && ch.poseSettleSec < POSE_SETTLE_SEC) {
    ch.poseSettleSec += dt;
    evaluate = ch.poseSettleSec >= POSE_SETTLE_SEC;
  }
  if (ch.poseTickSec <= 0) {
    ch.poseTickSec = POSE_TICK_SEC;
    // A status still settling waits for its own evaluation.
    evaluate = evaluate || working || ch.poseSettleSec >= POSE_SETTLE_SEC;
  }
  if (!evaluate) return ch.pose;

  let next = idlePose({
    status: ch.agentStatus,
    idleSec: ch.idleSec,
    hasSeat: ch.seatId !== null,
    seed: ch.id,
    sofaFree: env.sofaFree(),
    coffeeReady: ch.coffeeCooldownSec <= 0,
    current: ch.pose,
  });
  if (next === IdlePose.COFFEE && ch.pose !== IdlePose.COFFEE && !env.startCoffee()) {
    next =
      ch.idleSec >= NAP_AFTER_IDLE_SEC || ch.pose === IdlePose.NAPPING
        ? IdlePose.NAPPING
        : IdlePose.READING;
  }
  if (next !== ch.pose) {
    ch.pose = next;
    ch.poseClockSec = 0;
  }
  return ch.pose;
}
