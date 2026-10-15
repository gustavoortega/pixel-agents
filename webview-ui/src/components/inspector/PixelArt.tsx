import type { ModelTier } from '../../../../core/src/provider.js';
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
