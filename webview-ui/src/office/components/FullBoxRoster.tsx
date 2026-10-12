import {
  FULL_BOX_MOOD_COLORS,
  FULL_BOX_STREAK_COLOR,
  FULL_BOX_XP_BAR_BG,
  FULL_BOX_XP_BAR_FILL,
} from '../../constants.js';
import { rarityColor } from '../flair/modelFlair.js';
import type { FullBoxRow } from '../fullBox.js';

/** Roster, model and session rows of the hover/selected box: name, level, XP bar, streak, mood,
 *  model, then the cache clock, permission mode and background shells as plain lines. */
export function FullBoxRoster({ rows }: { rows: FullBoxRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 pt-2" data-testid="full-box-roster">
      {rows.map((row) => {
        switch (row.kind) {
          case 'name':
            return (
              <span key="name" className="text-2xs leading-none">
                {row.text}
              </span>
            );
          case 'level':
            return (
              <span key="level" className="text-2xs leading-none">
                {row.text}
              </span>
            );
          case 'xp':
            return (
              <div key="xp" className="flex items-center gap-4">
                <div style={{ width: 60, height: 6, background: FULL_BOX_XP_BAR_BG }}>
                  <div
                    style={{
                      width: `${row.fraction * 100}%`,
                      height: '100%',
                      background: FULL_BOX_XP_BAR_FILL,
                    }}
                  />
                </div>
                <span className="text-2xs leading-none">{row.text}</span>
              </div>
            );
          case 'streak':
            return (
              <span
                key="streak"
                className="text-2xs leading-none"
                style={{ color: FULL_BOX_STREAK_COLOR }}
              >
                {`Streak ${row.count}`}
              </span>
            );
          case 'mood':
            return (
              <span
                key="mood"
                className="text-2xs leading-none"
                style={{ color: FULL_BOX_MOOD_COLORS[row.mood] }}
              >
                {row.mood}
              </span>
            );
          case 'model':
            return (
              <span
                key="model"
                className="text-2xs leading-none"
                style={{ color: rarityColor(row.rarity) }}
              >
                {row.text}
              </span>
            );
          case 'cache':
          case 'mode':
          case 'shells':
            return (
              <span key={row.kind} className="text-2xs leading-none">
                {row.text}
              </span>
            );
        }
      })}
    </div>
  );
}
