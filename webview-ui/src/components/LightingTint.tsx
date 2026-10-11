import { useEffect, useState } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import { lightingFor } from '../office/lighting.js';
import { mapRectCss, overlayProjection } from '../office/projection.js';

interface LightingTintProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/**
 * Time-of-day tint over the map. A DOM layer rather than a canvas fill because the canvas is
 * transparent outside the map: this div covers the map rect exactly and nothing around it. It
 * is positioned through the same `overlayProjection` the nameplates use, on the same frame
 * tick, so it never lags a pan, zoom or resize. Sits between the canvas and the label layer.
 */
export function LightingTint({ officeState, containerRef, zoom, panRef }: LightingTintProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const now = new Date();
  const { tint } = lightingFor(now.getHours(), now.getMinutes());
  if (!tint) return null;
  const layout = officeState.getLayout();
  const project = overlayProjection(
    layout,
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );
  const rect = mapRectCss(project, layout);
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        ...rect,
        background: tint.color,
        opacity: tint.alpha,
        mixBlendMode: 'soft-light',
        zIndex: 5,
      }}
      data-testid="lighting-tint"
    />
  );
}
