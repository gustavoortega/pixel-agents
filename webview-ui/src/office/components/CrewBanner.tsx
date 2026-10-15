import {
  CREW_BANNER_BORDER_PX,
  CREW_BANNER_CHIP_FONT_PX,
  CREW_BANNER_COUNT_FONT_PX,
  CREW_BANNER_INK_2,
  CREW_BANNER_INK_3,
  CREW_BANNER_LABEL_FONT_PX,
  CREW_BANNER_NAME_FONT_PX,
  CREW_BANNER_PAD_X_PX,
  CREW_BANNER_PAD_Y_PX,
  CREW_BANNER_PIP_PX,
  CREW_BANNER_ROW1_PX,
  CREW_BANNER_ROW2_PX,
  CREW_BANNER_ROW3_PX,
  CREW_BANNER_SHADOW_PX,
  CREW_BANNER_Z_INDEX,
} from '../../constants.js';
import { CREW_BANNER_LABEL, type CrewBannerPhase, type CrewBannerView } from '../crewBanner.js';
import type { Rect } from '../labelLayout.js';

function PhaseChip({ phase }: { phase: CrewBannerPhase }) {
  return (
    <span
      className="flex items-center whitespace-nowrap leading-none shrink-0"
      style={{
        height: CREW_BANNER_ROW2_PX - 4,
        padding: '0 5px',
        gap: 3,
        border: '2px solid var(--brand-ink)',
        background: phase.newest ? 'var(--brand-gold)' : 'var(--brand-paper-2)',
        color: CREW_BANNER_INK_2,
        fontSize: CREW_BANNER_CHIP_FONT_PX,
      }}
      data-testid="crew-phase"
    >
      <span className="pv">{phase.name}</span>
      {phase.pips > 0 && (
        <span className="flex items-center" style={{ gap: 2, marginLeft: 3 }}>
          {Array.from({ length: phase.pips }, (_, i) => (
            <span
              key={i}
              data-testid="crew-pip"
              data-done={i < phase.filled ? 'true' : 'false'}
              style={{
                width: CREW_BANNER_PIP_PX,
                height: CREW_BANNER_PIP_PX,
                boxSizing: 'border-box',
                background: i < phase.filled ? 'var(--brand-ink)' : 'transparent',
                border: '1px solid var(--brand-ink)',
              }}
            />
          ))}
        </span>
      )}
      {phase.more > 0 && <span>+{phase.more}</span>}
    </span>
  );
}

/** A running workflow's banner, at `rect` (CSS px, sized by crewBannerSize). Shows, never clicks. */
export function CrewBanner({
  view,
  rect,
  scale,
  leadId,
  wall = false,
}: {
  view: CrewBannerView;
  /** The reserved box, its hard shadow included. */
  rect: Rect;
  /** The plates' scale: the banner is authored at 1 and scaled about its top centre. */
  scale: number;
  leadId: number;
  /** Hung on the room's top wall: the counts share the chips' row (crewBannerSize's wall form). */
  wall?: boolean;
}) {
  const w = rect.w / scale;
  const h = rect.h / scale - CREW_BANNER_SHADOW_PX;
  return (
    <div
      className="absolute flex flex-col overflow-hidden"
      style={{
        left: rect.x + rect.w / 2,
        top: rect.y,
        width: w,
        height: h,
        transform: `translateX(-50%) scale(${scale})`,
        transformOrigin: 'top center',
        padding: `${CREW_BANNER_PAD_Y_PX}px ${CREW_BANNER_PAD_X_PX}px`,
        background: 'var(--brand-paper)',
        color: 'var(--brand-ink)',
        border: `${CREW_BANNER_BORDER_PX}px solid var(--brand-ink)`,
        boxShadow: 'var(--brand-shadow)',
        pointerEvents: 'none',
        zIndex: CREW_BANNER_Z_INDEX,
      }}
      data-testid="crew-banner"
      data-lead-id={leadId}
      data-wall={wall ? 'true' : 'false'}
    >
      <div
        className="flex items-baseline whitespace-nowrap leading-none"
        style={{ height: CREW_BANNER_ROW1_PX, gap: 6, paddingTop: 3 }}
      >
        {view.named && (
          <span
            style={{
              fontSize: CREW_BANNER_LABEL_FONT_PX,
              letterSpacing: '0.1em',
              color: CREW_BANNER_INK_3,
            }}
          >
            {CREW_BANNER_LABEL}
          </span>
        )}
        <span
          className={view.named ? 'pv' : undefined}
          style={{ fontSize: CREW_BANNER_NAME_FONT_PX }}
          data-testid="crew-banner-name"
        >
          {view.title}
        </span>
        <span style={{ fontSize: CREW_BANNER_COUNT_FONT_PX, color: CREW_BANNER_INK_2 }}>
          {'·'} {view.lead}
        </span>
      </div>
      {(view.phases.length > 0 || (wall && view.counts)) && (
        <div
          className="flex items-center whitespace-nowrap"
          style={{ height: CREW_BANNER_ROW2_PX, gap: 6 }}
        >
          {view.phases.map((p, i) => (
            <span key={`${i}:${p.name}`} className="flex items-center" style={{ gap: 6 }}>
              {i > 0 && (
                <span style={{ fontSize: CREW_BANNER_CHIP_FONT_PX, color: CREW_BANNER_INK_3 }}>
                  {'›'}
                </span>
              )}
              <PhaseChip phase={p} />
            </span>
          ))}
          {wall && view.counts && (
            <span
              className="leading-none"
              style={{
                fontSize: CREW_BANNER_COUNT_FONT_PX,
                color: CREW_BANNER_INK_2,
                marginLeft: view.phases.length > 0 ? 6 : 0,
              }}
              data-testid="crew-banner-counts"
            >
              {view.counts}
            </span>
          )}
        </div>
      )}
      {!wall && view.counts && (
        <div
          className="whitespace-nowrap leading-none flex items-center"
          style={{
            height: CREW_BANNER_ROW3_PX,
            fontSize: CREW_BANNER_COUNT_FONT_PX,
            color: CREW_BANNER_INK_2,
          }}
          data-testid="crew-banner-counts"
        >
          {view.counts}
        </div>
      )}
    </div>
  );
}
