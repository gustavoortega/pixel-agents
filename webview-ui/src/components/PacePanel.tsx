import type { UsageLimits } from '../../../core/src/messages.js';
import { hudLimits, noLiveLimits, paceRows, paceTipKey } from './limitsPace.js';

/**
 * The official limits as the rail's bottom panel: one phrase per live window (`5 h block ·
 * runs out 18:33`, `Week · 66% at reset`), its bar with the even-pace tick, and when it resets.
 * Not installed: how to turn it on. Installed with nothing live: waiting. A window with no
 * reading has no row: never a 0.
 */
export function PacePanel({
  limits,
  installed,
  now,
  slim,
}: {
  limits: UsageLimits | null;
  installed: boolean;
  now: number;
  slim: boolean;
}) {
  if (installed && limits === null) return null;
  if (slim) {
    const figures = installed ? hudLimits(limits, now) : [];
    if (figures.length === 0) return null;
    return (
      <div className="pace pace-slim" data-testid="pace-panel" title="Official usage limits">
        <div data-testid="hud-limits">
          {figures.map((f) => (
            <div key={f.key} className={`pc-mini ${f.tone}`}>
              {f.text}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const body = (() => {
    if (!installed) {
      return (
        <p className="pc-hint m-0">
          Official limits are off. Turn on "Claude status line" in Settings.
        </p>
      );
    }
    if (noLiveLimits(limits, now)) {
      return <p className="pc-hint m-0">Waiting for Claude Code's status line…</p>;
    }
    const rows = paceRows(limits, now);
    const tip = paceTipKey(rows);
    return (
      <div data-testid="hud-limits">
        {rows.map((row) => (
          <div
            key={row.key}
            className={`pc-row ${row.tone}${row.age ? ' stale' : ''}`}
            data-window={row.key}
          >
            <div className="pc-line">
              <span className="k">{row.label}</span>
              <span className="dot">{'·'}</span>
              {row.head.before && <span>{row.head.before}</span>}
              <span className="v">{row.head.value}</span>
              {row.head.after && <span>{row.head.after}</span>}
            </div>
            <div className="bar">
              <i style={{ width: `${row.fill}%` }} />
              <u style={{ left: `${row.mark}%` }} />
            </div>
            <div className="pc-note">
              <span>
                resets <b>{row.resetAt}</b> {'·'} in {row.resetIn}
                {row.age && ` · read ${row.age}`}
              </span>
              {!row.usedInHead && <span className="used">{row.used}% used</span>}
            </div>
            {tip === row.key && <div className="pc-tip">slow down or use a cheaper model</div>}
          </div>
        ))}
      </div>
    );
  })();
  return (
    <section className="pace" data-testid="pace-panel" aria-label="Pace">
      <div className="pace-h">Pace</div>
      {body}
    </section>
  );
}
