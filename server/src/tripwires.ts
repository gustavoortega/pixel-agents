import type { AgentState } from './types.js';

export type TripwireSeverity = 'high' | 'medium' | 'low';

/**
 * A detection rule over one tool call. `input` is matched against every string
 * leaf of the tool input, so a benign token elsewhere in the call cannot mask a
 * malicious one: exclusions belong inside the pattern as per-occurrence negative
 * lookaheads, never as a separate "unless" rule.
 */
export interface TripwireRule {
  id: string;
  /** Short human label shown in the office. ASCII, validated at load. */
  name: string;
  severity: TripwireSeverity;
  tool: RegExp;
  /** Absent means the rule fires on the tool name alone. */
  input?: RegExp;
  /** Input keys whose subtree is not scanned, at any depth. */
  ignoreKeys?: string[];
}

/**
 * Keys that carry prose or search terms rather than targets, for path-style
 * rules: a Grep pattern, a Task prompt or a document being written must not
 * alarm, while Grep `path`, Read `file_path` and Bash `command` stay scanned.
 */
export const PATH_IGNORE_KEYS: string[] = [
  'pattern',
  'description',
  'prompt',
  'content',
  'old_string',
  'new_string',
  'todos',
];

/** Deepest nesting scanned. The 64 KB hook body limit bounds the leaf count and size. */
const MAX_LEAF_DEPTH = 6;

const SEVERITY_RANK: Record<TripwireSeverity, number> = { low: 1, medium: 2, high: 3 };

function anyLeafMatches(
  value: unknown,
  re: RegExp,
  ignoreKeys: readonly string[],
  depth: number,
): boolean {
  if (depth > MAX_LEAF_DEPTH) return false;
  if (typeof value === 'string') return re.test(value);
  if (Array.isArray(value)) {
    return value.some((item) => anyLeafMatches(item, re, ignoreKeys, depth + 1));
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (ignoreKeys.includes(key)) continue;
      if (anyLeafMatches(child, re, ignoreKeys, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * The rule a tool call trips, or null. Several hits resolve to the highest
 * severity, then definition order.
 */
export function evaluateTripwires(
  rules: readonly TripwireRule[],
  toolName: string,
  input: unknown,
): TripwireRule | null {
  let best: TripwireRule | null = null;
  for (const rule of rules) {
    if (best && SEVERITY_RANK[rule.severity] <= SEVERITY_RANK[best.severity]) continue;
    if (!rule.tool.test(toolName)) continue;
    if (rule.input && !anyLeafMatches(input, rule.input, rule.ignoreKeys ?? [], 0)) continue;
    best = rule;
  }
  return best;
}

function tripwireMessage(agent: AgentState): Record<string, unknown> {
  const t = agent.tripwire!;
  return {
    type: 'agentTripwire',
    id: agent.id,
    ruleId: t.ruleId,
    ruleName: t.ruleName,
    severity: t.severity,
    count: t.count,
  };
}

/**
 * Record a hit on the agent and return the `agentTripwire` message to broadcast.
 * `count` is every hit since the last ack; the displayed rule is the highest
 * severity seen since then (the latest among equals), so a lower-severity hit
 * only bumps the count. Only ids and labels cross the wire, never matched text.
 */
export function applyTripwireHit(agent: AgentState, rule: TripwireRule): Record<string, unknown> {
  const prev = agent.tripwire;
  const count = (prev?.count ?? 0) + 1;
  if (!prev || SEVERITY_RANK[rule.severity] >= SEVERITY_RANK[prev.severity]) {
    agent.tripwire = {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      count,
    };
  } else {
    agent.tripwire = { ...prev, count };
  }
  return tripwireMessage(agent);
}

/**
 * Apply a client ack and return the message to broadcast, or null when the
 * agent has no alarm. The alarm clears only when the client saw every hit
 * (`count` covers the current one); a stale ack re-sends the current state so
 * no hit is lost.
 */
export function ackTripwire(agent: AgentState, count: number): Record<string, unknown> | null {
  if (!agent.tripwire) return null;
  if (count >= agent.tripwire.count) {
    delete agent.tripwire;
    return { type: 'agentTripwireClear', id: agent.id };
  }
  return tripwireMessage(agent);
}

/** The message a reconnecting client needs for this agent: its alarm, or a clear. */
export function tripwireResendMessage(agent: AgentState): Record<string, unknown> {
  return agent.tripwire ? tripwireMessage(agent) : { type: 'agentTripwireClear', id: agent.id };
}
