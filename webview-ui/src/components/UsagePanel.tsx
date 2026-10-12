import { useState } from 'react';

import type { TokenUsage, TokenWindow, UsageLimits } from '../../../core/src/messages.js';
import { USAGE_LIMITS_TICK_MS } from '../constants.js';
import { useNow } from '../hooks/useNow.js';
import {
  LIMIT_TONE_CLASS,
  type LimitKey,
  limitsNudge,
  noLiveLimits,
  officialRow,
} from './limitsPace.js';
import { Button } from './ui/Button.js';
import {
  areaBars,
  formatPct,
  formatTokens,
  leader,
  LOBBY_LABEL,
  modelChips,
  modelTooltip,
  type UsageMetric,
  windowCaption,
} from './usageView.js';

type UsageTab = 'block' | 'week';

interface UsagePanelProps {
  usage: TokenUsage | null;
  /** Official limits from the status line wrapper; null until this window's server says it receives them. */
  limits: UsageLimits | null;
  /** The wrapper is chained in ~/.claude/settings.json (hooksStatus for 'claude-statusline'). */
  statuslineInstalled: boolean;
  onClose: () => void;
}

/** Bars that pass their budget turn red; the fill itself never exceeds the track. */
function Bar({ fraction, over }: { fraction: number; over?: boolean }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="h-8 bg-paper-dark border border-ink-muted">
      <div
        className={`h-full ${over ? 'bg-ink-bar-over' : 'bg-ink-bar'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * The official row for the open tab, above the token totals and whatever state they are in. Not installed: how to
 * turn it on. Installed with nothing live: waiting, once this window's server said it receives the limits (a window
 * reusing another's server never hears, and shows nothing new). Otherwise the reading, its pace, and at most one
 * nudge across both windows.
 */
function OfficialLimits({
  limits,
  installed,
  limitKey,
  now,
}: {
  limits: UsageLimits | null;
  installed: boolean;
  limitKey: LimitKey;
  now: number;
}) {
  if (!installed) {
    return (
      <p className="text-xs text-ink-muted mb-6">
        Official limits are off. Turn on "Claude status line" in Settings.
      </p>
    );
  }
  if (limits === null) return null;
  if (noLiveLimits(limits, now)) {
    return <p className="text-xs text-ink-muted mb-6">Waiting for Claude Code's status line…</p>;
  }
  const row = officialRow(limits, limitKey, now);
  const nudge = limitsNudge(limits, now);
  return (
    <div className="mb-6 text-xs" data-testid="official-limits">
      {row && (
        <div className={row.stale ? 'opacity-60' : undefined}>
          <div>
            <span className={LIMIT_TONE_CLASS[row.tone]}>{row.text}</span>
          </div>
          {row.pace && <div className="text-ink-muted">{row.pace}</div>}
        </div>
      )}
      {nudge && <div className={LIMIT_TONE_CLASS.red}>{nudge}</div>}
    </div>
  );
}

export function UsagePanel({ usage, limits, statuslineInstalled, onClose }: UsagePanelProps) {
  const [tab, setTab] = useState<UsageTab>('block');
  const [metric, setMetric] = useState<UsageMetric>('weighted');
  const now = useNow(USAGE_LIMITS_TICK_MS);

  const win: TokenWindow | undefined = tab === 'block' ? usage?.block : usage?.week;
  const budget = tab === 'block' ? usage?.budget5h : usage?.budgetWeek;
  const top = win ? leader(win, metric) : null;
  const bars = win ? areaBars(win, metric) : [];
  const unit = metric === 'weighted' ? 'weighted' : 'raw';

  const tabClass = (active: boolean) =>
    `py-2 px-12 border-3 border-brand-ink rounded-none cursor-pointer text-sm ${
      active
        ? 'bg-brand-ink text-brand-paper'
        : 'bg-brand-paper text-brand-ink hover:bg-brand-paper-2'
    }`;

  return (
    <div
      className="absolute top-10 right-10 z-30 w-[400px] max-h-[calc(100%-80px)] overflow-y-auto brand-panel p-10"
      role="dialog"
      aria-label="Token usage"
    >
      <div className="flex items-center justify-between mb-6">
        <span className="text-xl">Usage</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-ink-muted! hover:text-ink!"
        >
          x
        </Button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <button className={tabClass(tab === 'block')} onClick={() => setTab('block')}>
          5 h
        </button>
        <button className={tabClass(tab === 'week')} onClick={() => setTab('week')}>
          Week
        </button>
        <button
          className="ml-auto py-2 px-8 border-2 border-ink-muted rounded-none cursor-pointer text-xs bg-paper text-ink-muted hover:text-ink"
          onClick={() => setMetric((m) => (m === 'weighted' ? 'raw' : 'weighted'))}
          title="Cost-weighted: input + 1.25 x cache write + 0.1 x cache read + 5 x output. Raw: plain sum of the four counters."
        >
          {metric === 'weighted' ? 'cost-weighted' : 'raw tokens'}
        </button>
      </div>

      <OfficialLimits
        limits={limits}
        installed={statuslineInstalled}
        limitKey={tab === 'block' ? 'fiveHour' : 'sevenDay'}
        now={now}
      />

      {!usage || usage.scanning ? (
        <p className="text-sm text-ink-muted py-8">Reading your transcripts…</p>
      ) : !win ? (
        <p className="text-sm text-ink-muted py-8">No active 5-hour block right now.</p>
      ) : (
        <>
          <div className="text-xs text-ink-muted mb-4">{windowCaption(win)}</div>

          <div className="mb-8">
            <span className="text-sm text-ink-muted">Eating the most: </span>
            {top ? (
              <span className="text-base">
                {top.name} {formatPct(top.share)}
              </span>
            ) : (
              <span className="text-base text-ink-muted">nothing yet</span>
            )}
          </div>

          <div className="flex items-baseline justify-between mb-8 text-sm">
            <span>
              {formatTokens(metric === 'weighted' ? win.total : win.raw)} {unit} tokens
            </span>
            {budget !== undefined && win.budgetPct !== undefined && (
              <span className={win.budgetPct > 1 ? 'text-ink-bar-over' : 'text-ink-muted'}>
                {formatPct(win.budgetPct)} of budget
              </span>
            )}
          </div>

          {tab === 'block' && budget === undefined && usage.biggestBlock !== undefined && (
            <div className="text-xs text-ink-muted mb-8">
              Your biggest 5-hour block in 7 days: {formatTokens(usage.biggestBlock)} weighted
            </div>
          )}

          <div className="flex flex-col gap-6 mb-10">
            {bars.map((b) => (
              <div key={b.key}>
                <div className="flex justify-between text-sm">
                  <span>
                    {b.lobby && <span className="text-ink-muted">{LOBBY_LABEL} · </span>}
                    {b.name}
                  </span>
                  <span className="text-ink-muted">
                    {formatTokens(b.value)} · {formatPct(b.share)}
                    {b.budgetPct !== undefined && ` · ${formatPct(b.budgetPct)} of budget`}
                  </span>
                </div>
                <Bar fraction={b.share} />
              </div>
            ))}
          </div>

          <div className="text-sm text-ink-muted mb-4">Sessions</div>
          <div className="flex flex-col gap-4">
            {win.bySession.map((s, i) => (
              <div
                key={s.sessionId}
                className="flex items-center gap-6 py-2 border-b border-paper-dark"
                title={modelTooltip(s)}
              >
                <span className="text-xs text-ink-muted w-16">{i + 1}</span>
                <span className="flex-1 min-w-0 text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                  {s.title ?? s.folder}
                  <span className="text-ink-muted"> · {s.area ?? s.folder}</span>
                </span>
                {modelChips(s).map((c) => (
                  <span
                    key={c.model}
                    className="text-2xs py-1 px-4 border border-ink-muted text-ink-muted"
                  >
                    {c.label}
                  </span>
                ))}
                <span className="text-sm w-60 text-right">
                  {formatTokens(metric === 'weighted' ? s.total : s.raw)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
