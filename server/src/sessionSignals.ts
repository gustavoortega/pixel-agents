import type { AgentMode, AgentShells, PermissionMode } from '../../core/src/messages.js';
import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { CONTEXT_SEED_TAIL_BYTES, SHELL_DONE_MEMO_MAX } from './constants.js';
import { clearCacheClock, readTailLines } from './contextUsage.js';
import { resetMonitorFacts } from './monitorFacts.js';
import type { AgentState } from './types.js';

/**
 * Session signals Claude Code shows in its own statusline, made real for the
 * office: the permission mode ("auto mode on") and the background shells still
 * running ("3 shells"). The third, the prompt-cache clock, lives in
 * contextUsage.ts next to the usage records it is read from.
 */

/** Every mode the protocol carries. A Record, so a mode added to the protocol
 *  does not compile here until it is listed. */
const KNOWN_PERMISSION_MODES: Record<PermissionMode, true> = {
  default: true,
  acceptEdits: true,
  plan: true,
  auto: true,
  bypassPermissions: true,
  dontAsk: true,
};

function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && Object.hasOwn(KNOWN_PERMISSION_MODES, value);
}

/** The agentMode message: `mode` omitted while unknown. */
export function modeMessage(id: number, agent: AgentState): Record<string, unknown> {
  if (agent.permissionMode === undefined) return { type: 'agentMode', id } satisfies AgentMode;
  return { type: 'agentMode', id, mode: agent.permissionMode } satisfies AgentMode;
}

/**
 * Keep the mode a transcript record states and tell the office when it
 * changed. A mode the protocol does not know is dropped and the previous one
 * stays: the CLI can add modes before the office learns them. Every user
 * record repeats the mode, so an unchanged one stays silent.
 */
export function applyPermissionMode(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  raw: string | undefined,
): void {
  if (!isPermissionMode(raw) || raw === agent.permissionMode) return;
  agent.permissionMode = raw;
  agents.broadcast(modeMessage(agentId, agent));
}

/**
 * Seed the mode from a transcript's tail when watching starts: adopted and
 * restored agents start at end-of-file, past every record that stated it.
 *
 * Only a record that states a mode changes it. The mode is the CLI process's
 * setting and survives /clear, so a fresh transcript without one leaves a
 * known mode alone. A file read from the start reaches its records through the
 * live replay; seeding too would flash the newest mode before the older ones.
 */
export function seedPermissionMode(
  agentId: number,
  agents: AgentStateStore,
  provider?: HookProvider | null,
): void {
  const agent = agents.get(agentId);
  if (!agent || !agent.jsonlFile || agent.fileOffset === 0) return;
  if (!provider?.extractPermissionMode) return;

  const lines = readTailLines(agent.jsonlFile, CONTEXT_SEED_TAIL_BYTES);
  if (!lines) return; // unreadable transcript -- the next prompt states the mode

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const mode = provider.extractPermissionMode(record);
    if (mode === undefined) continue;
    // The newest statement is the mode, even one the office does not know.
    applyPermissionMode(agentId, agent, agents, mode);
    return;
  }
}

/** The agentShells message: always a count, 0 when nothing runs. */
export function shellsMessage(id: number, agent: AgentState): Record<string, unknown> {
  return {
    type: 'agentShells',
    id,
    running: agent.runningShellIds?.size ?? 0,
  } satisfies AgentShells;
}

/**
 * A background shell launched: its tool result carried a background task id.
 * The result is the proof, not the tool call: a launch the user denied has a
 * result too, without the id, and must never count. A task notification that
 * already arrived for this id (it can land before the result) means the shell
 * is already done.
 */
export function noteShellLaunched(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  toolUseId: string,
  taskId: string,
): void {
  if (agent.shellDoneBeforeLaunch?.delete(toolUseId)) return;
  const running = (agent.runningShellIds ??= new Map());
  if (running.has(toolUseId)) return;
  running.set(toolUseId, taskId);
  agents.broadcast(shellsMessage(agentId, agent));
}

/**
 * Count down a shell this agent saw launch; false for any other id, so the
 * count never goes negative. The prompt and attachment copies of a task
 * notification come straight here: they always land after the launch's result
 * and mostly repeat an enqueue that already counted it down, so a miss is
 * nothing to remember.
 */
export function noteShellEnded(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  toolUseId: string,
): boolean {
  if (!agent.runningShellIds?.delete(toolUseId)) return false;
  agents.broadcast(shellsMessage(agentId, agent));
  return true;
}

/**
 * A TaskStop result names the task it stopped. A stopped shell never gets a
 * task notification, so this is its only end. Any other task (an agent, a
 * workflow, a shell from before /clear) matches nothing here.
 */
export function noteShellStopped(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  taskId: string,
): void {
  for (const [toolUseId, runningTaskId] of agent.runningShellIds ?? []) {
    if (runningTaskId !== taskId) continue;
    noteShellEnded(agentId, agent, agents, toolUseId);
    return;
  }
}

/**
 * An enqueued task notification for `toolUseId` (completed, failed, killed or
 * stopped alike). Any id that is not a running shell (a sub-agent's shell,
 * another kind of task, a launch whose result is still ahead) is remembered
 * for a while in case its launch shows up next.
 */
export function noteTaskDone(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  toolUseId: string,
): void {
  if (noteShellEnded(agentId, agent, agents, toolUseId)) return;
  const memo = (agent.shellDoneBeforeLaunch ??= new Set());
  memo.add(toolUseId);
  if (memo.size > SHELL_DONE_MEMO_MAX) {
    const oldest = memo.values().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
}

/**
 * Drop what belonged to a transcript or a process that is gone, and tell the
 * office. The cache clock and the shells always go: after /clear or resume the
 * old transcript is no longer read, so a shell it launched would never be seen
 * to finish. The mode is the CLI process's setting and survives /clear and
 * resume; only a session that ends for good clears it.
 */
export function resetSessionSignals(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  opts: { keepMode: boolean },
): void {
  clearCacheClock(agentId, agent, agents);
  agent.runningShellIds = undefined;
  agent.shellDoneBeforeLaunch = undefined;
  agents.broadcast(shellsMessage(agentId, agent));
  // Artifacts, loop and tests belong to the transcript that is gone too.
  resetMonitorFacts(agentId, agent, agents);
  if (opts.keepMode) return;
  agent.permissionMode = undefined;
  agents.broadcast(modeMessage(agentId, agent));
}
