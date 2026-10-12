import { useEffect, useState } from 'react';

/** Epoch ms, refreshed every `intervalMs`: enough for countdowns shown in minutes, without a render per second. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
