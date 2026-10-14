import { useEffect, useRef } from 'react';

import { type FrameInfo, onFrame } from '../office/engine/gameLoop.js';

/**
 * Run `callback` after every frame the canvas draws, so a DOM overlay redraws exactly as often as
 * the canvas under it (30 fps while something moves, much less when the office is quiet).
 * Subscribes on mount; the latest callback is the one called.
 */
export function useFrame(callback: (frame: FrameInfo) => void): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => onFrame((frame) => latest.current(frame)), []);
}
