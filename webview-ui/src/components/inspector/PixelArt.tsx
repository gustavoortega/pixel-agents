import type { ModelTier } from '../../../../core/src/provider.js';
import { MEDAL_GRID } from '../../constants.js';
import { type MedalCell, medalCell, medalPercent } from '../../office/medal.js';
import type { RingTone } from './inspectorView.js';
import { type Bitmap, gemBitmap, type IconName, ICONS, pixelRuns } from './pixelBitmaps.js';

/** A character grid as crisp SVG rects, `scale` CSS px per pixel. Decoration: hidden from readers. */
function PixelBitmap({
  rows,
  scale,
  className,
}: {
  rows: Bitmap;
  scale: number;
  className?: string;
}) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  return (
    <svg
      className={`insp-px${className ? ` ${className}` : ''}`}
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {pixelRuns(rows).map((r) => (
        <rect
          key={`${r.x}:${r.y}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          className={`px-${r.ch}`}
        />
      ))}
    </svg>
  );
}

export function PixelIcon({ name, scale = 2 }: { name: IconName; scale?: number }) {
  return <PixelBitmap rows={ICONS[name]} scale={scale} className={`insp-ic-${name}`} />;
}

export function Gem({ tier, scale = 2 }: { tier: ModelTier; scale?: number }) {
  return <PixelBitmap rows={gemBitmap(tier)} scale={scale} />;
}

/** The tier glyph's highlight class per tier (the palette's `px-x`..`px-v`). */
const TIER_HI_CLASS: Record<ModelTier, string> = { 1: 'x', 2: 'y', 3: 'z', 4: 'v' };

function ringClass(cell: MedalCell, tier: ModelTier | undefined): string | null {
  switch (cell) {
    case 'on':
      return 'px-ring-on';
    case 'off':
      return 'px-ring-off';
    case 'hole':
      return 'px-k';
    case 'f':
      return tier === undefined ? 'px-k' : `px-${tier}`;
    case 'h':
      return tier === undefined ? 'px-k' : `px-${TIER_HI_CLASS[tier]}`;
    default:
      return null;
  }
}

/**
 * The context cell's ring: the medal's 12 px grid at `scale` (24 CSS px at 2), filled clockwise
 * to the context share in its tone's color, the tier glyph in the hole. Inspector colors (CSS
 * classes on the paper), so the rail's and the plates' medals keep theirs.
 */
export function ContextRing({
  fraction,
  tone,
  tier,
  scale = 2,
}: {
  fraction: number;
  tone: RingTone;
  tier?: ModelTier;
  scale?: number;
}) {
  const filled = medalPercent(fraction) / 100;
  const runs: Array<{ x: number; y: number; w: number; cls: string }> = [];
  for (let y = 0; y < MEDAL_GRID; y++) {
    for (let x = 0; x < MEDAL_GRID; x++) {
      const cls = ringClass(medalCell(x, y, filled, tier ?? null), tier);
      if (cls === null) continue;
      const last = runs[runs.length - 1];
      if (last && last.y === y && last.cls === cls && last.x + last.w === x) last.w++;
      else runs.push({ x, y, w: 1, cls });
    }
  }
  const px = MEDAL_GRID * scale;
  return (
    <svg
      className={`insp-px insp-ring insp-ring-${tone}`}
      width={px}
      height={px}
      viewBox={`0 0 ${MEDAL_GRID} ${MEDAL_GRID}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-testid="inspector-context-ring"
      data-tone={tone}
    >
      {runs.map((r) => (
        <rect key={`${r.x}:${r.y}`} x={r.x} y={r.y} width={r.w} height={1} className={r.cls} />
      ))}
    </svg>
  );
}
