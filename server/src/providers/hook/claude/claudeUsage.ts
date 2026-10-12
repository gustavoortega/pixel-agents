import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  QuotaSignal,
  TranscriptUsageSource,
  UsageLine,
  UsageTranscript,
} from '../../../../../core/src/provider.js';

/**
 * Claude's side of the token ledger: where transcripts live and how a line reads.
 * Record shape (message.id, message.usage, message.model, quotaLimits, sessionId) is read HERE and nowhere else.
 */

const SUBAGENTS_DIR = 'subagents';
const WORKFLOWS_DIR = 'workflows';
const WORKFLOW_RUN_DIR_PREFIX = 'wf_';

/** Lines worth a JSON parse: usage-bearing assistant records and the two title record kinds. Quota announcements
 *  ride on usage-bearing (synthetic error) records. */
const LINE_PREFILTERS = ['"usage"', '"custom-title"', '"ai-title"'] as const;

const QUOTA_WINDOW_BY_TYPE: Record<string, QuotaSignal['window']> = {
  five_hour: 'block',
  seven_day: 'week',
};

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function readDirSafe(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statIfFresh(
  file: string,
  projectDirName: string,
  fallbackSessionId: string,
  minMtimeMs: number,
): Promise<UsageTranscript | null> {
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile() || st.mtimeMs < minMtimeMs) return null;
    return { path: file, projectDirName, fallbackSessionId, size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** Workflow agents' transcripts: `workflows/wf_<runId>/agent-<id>.jsonl`, one
 *  level deep only. Their records carry the lead's sessionId, so they count to
 *  the lead's session through the same per-path read as every other file. */
async function listWorkflowTranscripts(
  workflowsDir: string,
  projectDirName: string,
  leadSessionId: string,
  minMtimeMs: number,
): Promise<UsageTranscript[]> {
  const out: UsageTranscript[] = [];
  for (const run of await readDirSafe(workflowsDir)) {
    if (!run.isDirectory() || !run.name.startsWith(WORKFLOW_RUN_DIR_PREFIX)) continue;
    const runDir = path.join(workflowsDir, run.name);
    for (const file of await readDirSafe(runDir)) {
      if (!file.isFile() || !file.name.startsWith('agent-') || !file.name.endsWith('.jsonl')) {
        continue;
      }
      const t = await statIfFresh(
        path.join(runDir, file.name),
        projectDirName,
        leadSessionId,
        minMtimeMs,
      );
      if (t) out.push(t);
    }
  }
  return out;
}

export function createClaudeTranscriptUsage(
  extractTitle: (record: unknown) => { customTitle?: string; aiTitle?: string } | null,
): TranscriptUsageSource {
  return {
    linePrefilters: LINE_PREFILTERS,

    usageRoot: () => path.join(os.homedir(), '.claude', 'projects'),

    /** `<root>/<project>/<session>.jsonl`, `<root>/<project>/<session>/subagents/*.jsonl` and
     *  `<root>/<project>/<session>/subagents/workflows/wf_<runId>/agent-<id>.jsonl`. */
    async listTranscripts(root, minMtimeMs): Promise<UsageTranscript[]> {
      const out: UsageTranscript[] = [];
      for (const project of await readDirSafe(root)) {
        if (!project.isDirectory()) continue;
        const projectPath = path.join(root, project.name);
        for (const entry of await readDirSafe(projectPath)) {
          if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            const t = await statIfFresh(
              path.join(projectPath, entry.name),
              project.name,
              entry.name.slice(0, -'.jsonl'.length),
              minMtimeMs,
            );
            if (t) out.push(t);
          } else if (entry.isDirectory()) {
            const subDir = path.join(projectPath, entry.name, SUBAGENTS_DIR);
            for (const sub of await readDirSafe(subDir)) {
              if (sub.isDirectory() && sub.name === WORKFLOWS_DIR) {
                out.push(
                  ...(await listWorkflowTranscripts(
                    path.join(subDir, sub.name),
                    project.name,
                    entry.name,
                    minMtimeMs,
                  )),
                );
                continue;
              }
              if (!sub.isFile() || !sub.name.endsWith('.jsonl')) continue;
              const t = await statIfFresh(
                path.join(subDir, sub.name),
                project.name,
                entry.name,
                minMtimeMs,
              );
              if (t) out.push(t);
            }
          }
        }
        await yieldToEventLoop();
      }
      return out;
    },

    parseUsageLine(line, fallbackSessionId): UsageLine | null {
      let r: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object') return null;
        r = parsed as Record<string, unknown>;
      } catch {
        return null;
      }

      const titles = extractTitle(r);
      if (titles) {
        const sessionId = typeof r.sessionId === 'string' ? r.sessionId : fallbackSessionId;
        return { title: { sessionId, ...titles } };
      }

      const ts = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN;
      if (!Number.isFinite(ts)) return null;
      const result: UsageLine = {};

      // Quota first: the records that announce it are synthetic API errors, skipped as usage below.
      const quota = r.quotaLimits as { rateLimitType?: unknown; resetsAt?: unknown } | undefined;
      const window =
        typeof quota?.rateLimitType === 'string'
          ? QUOTA_WINDOW_BY_TYPE[quota.rateLimitType]
          : undefined;
      if (window && typeof quota?.resetsAt === 'number' && Number.isFinite(quota.resetsAt)) {
        result.quota = { window, ts, resetsAt: quota.resetsAt * 1000 };
      }

      const message = r.message as
        { id?: unknown; model?: unknown; usage?: Record<string, unknown> } | undefined;
      const usage = message?.usage;
      if (
        usage &&
        typeof usage === 'object' &&
        typeof message?.id === 'string' &&
        typeof message.model === 'string' &&
        message.model !== '<synthetic>'
      ) {
        const counts: [number, number, number, number] = [
          count(usage.input_tokens),
          count(usage.cache_creation_input_tokens),
          count(usage.cache_read_input_tokens),
          count(usage.output_tokens),
        ];
        if (counts.some((c) => c > 0)) {
          result.usage = {
            messageId: message.id,
            sessionId: typeof r.sessionId === 'string' ? r.sessionId : fallbackSessionId,
            ts,
            model: message.model,
            usage: counts,
          };
        }
      }

      return result.usage || result.quota ? result : null;
    },
  };
}
