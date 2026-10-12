import {
  USAGE_LIMIT_MAX_PCT,
  USAGE_LIMIT_RESETS_AT_MAX_S,
  USAGE_LIMIT_RESETS_AT_MIN_S,
} from '../constants.js';

/**
 * The only body POST /api/statusline/:providerId accepts, checked by hand rather than by a Fastify schema. Fastify's
 * default AJV runs with removeAdditional and type coercion, so a schema would strip an unknown key and answer 200,
 * and turn `null` or `"37"` in a number field into 0 or 37. Here an extra key at either level is a 400: a wrapper that
 * forwarded the whole status line input (cwd, model, session, cost) is refused instead of quietly trimmed, which is
 * the server's half of the privacy promise. And a value is used only if it already is a finite number in range.
 */

/** One window as the wrapper reports it: percent used, and the reset in epoch SECONDS. */
export interface LimitSample {
  usedPercentage: number;
  resetsAt: number;
}

export interface UsageLimitsBody {
  fiveHour: LimitSample | null;
  sevenDay: LimitSample | null;
}

const BODY_KEYS = ['fiveHour', 'sevenDay'] as const;
const WINDOW_KEYS = ['usedPercentage', 'resetsAt'] as const;
const INVALID = Symbol('invalid');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function finiteIn(value: unknown, min: number, max: number, maxInclusive: boolean): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    (maxInclusive ? value <= max : value < max)
  );
}

function parseWindow(value: unknown): LimitSample | null | typeof INVALID {
  if (value === null) return null;
  if (!isPlainObject(value) || !hasExactlyKeys(value, WINDOW_KEYS)) return INVALID;
  const { usedPercentage, resetsAt } = value;
  if (!finiteIn(usedPercentage, 0, USAGE_LIMIT_MAX_PCT, true)) return INVALID;
  if (!finiteIn(resetsAt, USAGE_LIMIT_RESETS_AT_MIN_S, USAGE_LIMIT_RESETS_AT_MAX_S, false)) {
    return INVALID;
  }
  return { usedPercentage: usedPercentage as number, resetsAt: resetsAt as number };
}

/** The validated body, or null for anything else, including two null windows (a post that says nothing). */
export function parseUsageLimitsBody(body: unknown): UsageLimitsBody | null {
  if (!isPlainObject(body) || !hasExactlyKeys(body, BODY_KEYS)) return null;
  const fiveHour = parseWindow(body.fiveHour);
  const sevenDay = parseWindow(body.sevenDay);
  if (fiveHour === INVALID || sevenDay === INVALID) return null;
  if (fiveHour === null && sevenDay === null) return null;
  return { fiveHour, sevenDay };
}
