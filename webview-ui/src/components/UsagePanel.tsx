import { useState } from 'react';

import type { TokenUsage, TokenWindow } from '../../../core/src/messages.js';
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

export function UsagePanel({ usage, onClose }: UsagePanelProps) {
  const [tab, setTab] = useState<UsageTab>('block');
  const [metric, setMetric] = useState<UsageMetric>('weighted');

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
