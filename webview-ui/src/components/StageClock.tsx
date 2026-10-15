import { useEffect, useState } from 'react';

import { HUD_ACTIVE_REFRESH_MS, HUD_CLOCK_REFRESH_MS } from '../constants.js';
import { useNow } from '../hooks/useNow.js';
import { countActiveAgents } from '../office/activeAgents.js';
import { officeNow } from '../office/clock.js';
import { clockLabel } from '../office/lighting.js';
import type { Character } from '../office/types.js';

interface StageClockProps {
  /** Live characters; read on a timer because their status is not React state. */
  characters: { values: () => Iterable<Pick<Character, 'isActive' | 'isSubagent'>> };
}

/**
 * The time, paper on ink at the stage's top right, with how many agents are working under it.
 * It reads the office clock, the one the light and every age read, so a staged scene shows the
 * time its light was set for.
 */
export function StageClock({ characters }: StageClockProps) {
  useNow(HUD_CLOCK_REFRESH_MS);
  const [active, setActive] = useState(() => countActiveAgents(characters.values()));
  useEffect(() => {
    const read = () => setActive(countActiveAgents(characters.values()));
    read();
    const id = setInterval(read, HUD_ACTIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [characters]);
  const now = officeNow();
  return (
    <div className="stage-clock" data-testid="stage-clock">
      <span className="time">{clockLabel(now.getHours(), now.getMinutes())}</span>
      <span className="active">{active === 0 ? 'none active' : `${active} active`}</span>
    </div>
  );
}
