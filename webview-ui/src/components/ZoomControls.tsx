import { ART_DENSITY } from '../../../core/src/assets/constants.js';
import { ZOOM_MAX, ZOOM_MIN } from '../constants.js';
import { stepZoom } from '../office/camera.js';
import { Button } from './ui/Button.js';

interface ZoomControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Auto-fit is following the rooms where agents work. */
  fitActive: boolean;
  /** Frame the working rooms again and keep following them. */
  onFit: () => void;
}

export function ZoomControls({ zoom, onZoomChange, fitActive, onFit }: ZoomControlsProps) {
  const minDisabled = zoom <= ZOOM_MIN;
  const maxDisabled = zoom >= ZOOM_MAX;

  return (
    <>
      {/* Vertically stacked buttons, top-left under the HUD clock. The zoom level is part of the
          cluster, not a badge floating over the map. */}
      <div className="absolute top-76 left-8 z-10 flex flex-col gap-6">
        <div
          className="brand-panel w-40 flex items-center justify-center text-sm select-none pointer-events-none"
          title="Zoom level"
          data-testid="zoom-level"
        >
          {/* Art px per device px: the ladder reads 0.5x, 1x, 2x, ... 10x */}
          {zoom / ART_DENSITY}x
        </div>
        <Button
          size="icon_lg"
          variant="brand"
          onClick={() => onZoomChange(stepZoom(zoom, 1))}
          disabled={maxDisabled}
          title="Zoom in (Ctrl+Scroll)"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line
              x1="9"
              y1="3"
              x2="9"
              y2="15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="3"
              y1="9"
              x2="15"
              y2="9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </Button>
        <Button
          size="icon_lg"
          variant="brand"
          onClick={() => onZoomChange(stepZoom(zoom, -1))}
          disabled={minDisabled}
          title="Zoom out (Ctrl+Scroll)"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line
              x1="3"
              y1="9"
              x2="15"
              y2="9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </Button>
        <Button
          size="icon_lg"
          variant={fitActive ? 'brandActive' : 'brand'}
          onClick={onFit}
          title="Fit the view to the rooms in use"
          className="text-sm"
        >
          Fit
        </Button>
      </div>
    </>
  );
}
