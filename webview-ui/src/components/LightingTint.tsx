import { useState } from 'react';

import { VIGNETTE_BACKGROUND } from '../constants.js';
import { useFrame } from '../hooks/useFrame.js';
import { officeNow } from '../office/clock.js';
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
 * Time-of-day tint and edge vignette over the map. A DOM layer rather than a canvas fill because the canvas is
 * transparent outside the map: this div covers the map rect exactly and nothing around it. It
 * is positioned through the same `overlayProjection` the nameplates use, on the canvas's drawn
 * frames, so it never lags a pan, zoom or resize. Sits between the canvas and the label layer. The vignette shows all day; the tint only outside plain daylight.
 */
export function LightingTint({ officeState, containerRef, zoom, panRef }: LightingTintProps) {
  const [, setTick] = useState(0);
  useFrame(() => setTick((n) => n + 1));

  const el = containerRef.current;
  if (!el) return null;
  const now = officeNow();
  const { tint } = lightingFor(now.getHours(), now.getMinutes());
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
    <>
      <div
        className="absolute pointer-events-none"
        style={{
          ...rect,
          background: VIGNETTE_BACKGROUND,
          zIndex: 5,
        }}
        data-testid="map-vignette"
      />
      {tint && (
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
      )}
    </>
  );
}
