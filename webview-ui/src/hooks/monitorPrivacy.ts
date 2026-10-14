import { useCallback, useState } from 'react';

import { MONITOR_PRIVACY_STORAGE_KEY } from '../constants.js';

/** Privacy mode as this browser last left it. Storage that cannot be read means off. */
export function readPrivacy(): boolean {
  try {
    return window.localStorage.getItem(MONITOR_PRIVACY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePrivacy(on: boolean): void {
  try {
    window.localStorage.setItem(MONITOR_PRIVACY_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // A preference that cannot be kept still applies to this page.
  }
}

/** Privacy mode (P): a per-browser preference, never sent to the server. */
export function usePrivacy(): [boolean, () => void] {
  const [on, setOn] = useState(readPrivacy);
  const toggle = useCallback(() => {
    setOn((prev) => {
      writePrivacy(!prev);
      return !prev;
    });
  }, []);
  return [on, toggle];
}
