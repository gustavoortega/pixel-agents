import type { ReactElement } from 'react';

import { MEDAL_GRID } from '../../constants.js';
import { medalIsHot, medalPercent, medalRuns, type MedalSpec } from '../medal.js';

/** One element per look and size: a medal changes only when its tier, whole percent or heat do. */
const memo = new Map<string, ReactElement>();

function medalLabel(spec: MedalSpec): string {
  return spec.fraction === null ? 'context unknown' : `${medalPercent(spec.fraction)}% context`;
}

/** The medal as crisp pixel rects at `px` CSS px (a whole multiple of the 12 px grid). */
export function Medal({ spec, px }: { spec: MedalSpec; px: number }) {
  const pct = spec.fraction === null ? 'none' : String(medalPercent(spec.fraction));
  const key = `${spec.tier ?? 0}:${pct}:${medalIsHot(spec.fraction) ? 1 : 0}:${px}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const el = (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${MEDAL_GRID} ${MEDAL_GRID}`}
      shapeRendering="crispEdges"
      className="shrink-0 block"
      role="img"
      aria-label={medalLabel(spec)}
      data-testid="plate-medal"
      {...(spec.fraction === null ? {} : { 'data-context-pct': medalPercent(spec.fraction) })}
    >
      {medalRuns(spec).map((r) => (
        <rect key={`${r.x}:${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
      ))}
    </svg>
  );
  memo.set(key, el);
  return el;
}
