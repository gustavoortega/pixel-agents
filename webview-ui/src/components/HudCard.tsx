import { ART_DENSITY } from '../../../core/src/assets/constants.js';
import { ZOOM_MAX, ZOOM_MIN } from '../constants.js';
import { stepZoom } from '../office/camera.js';

interface HudCardProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Auto-fit is following the rooms where agents work. */
  fitActive: boolean;
  /** Frame the working rooms again and keep following them. */
  onFit: () => void;
}

/** The zoom controls at the bottom bar's left end: out, in, fit, and the level. The time and the
 *  active count live in the stage clock, the official limits in the rail's Pace panel. */
export function HudCard({ zoom, onZoomChange, fitActive, onFit }: HudCardProps) {
  return (
    <div className="hud-zoom" data-testid="hud-card">
      <button
        type="button"
        className="brand-btn"
        onClick={() => onZoomChange(stepZoom(zoom, -1))}
        disabled={zoom <= ZOOM_MIN}
        title="Zoom out (Ctrl+Scroll)"
        aria-label="Zoom out"
      >
        -
      </button>
      <button
        type="button"
        className="brand-btn"
        onClick={() => onZoomChange(stepZoom(zoom, 1))}
        disabled={zoom >= ZOOM_MAX}
        title="Zoom in (Ctrl+Scroll)"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        type="button"
        className={fitActive ? 'brand-btn brand-btn-active' : 'brand-btn'}
        onClick={onFit}
        title="Fit the view to the rooms in use"
        aria-label="Fit the view to the rooms in use"
        aria-pressed={fitActive}
      >
        Fit
      </button>
      {/* Art px per device px: the ladder reads 0.5x, 1x, 2x, ... 10x */}
      <span className="hud-level" title="Zoom level" data-testid="zoom-level">
        {zoom / ART_DENSITY}x
      </span>
    </div>
  );
}
