/**
 * The wall clock the office reads for daylight, window shafts and the pets' sun spots.
 * Always the real time, except when the dev-only hero scene overrides it to pin the light.
 */

let override: (() => Date) | null = null;

export function officeNow(): Date {
  return override ? override() : new Date();
}

/** Replace the clock; `null` restores the real one. Only the dev-only hero scene calls this. */
export function overrideOfficeClock(fn: (() => Date) | null): void {
  override = fn;
}
