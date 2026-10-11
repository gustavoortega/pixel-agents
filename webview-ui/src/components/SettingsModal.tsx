import { useRef, useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { isBrowserRuntime } from '../runtime.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  /** Whether headless agents (adopted, no terminal to focus) render translucent. */
  ghostHeadlessAgents: boolean;
  onToggleGhostHeadlessAgents: () => void;
  /** Whether each agent shows its model's rarity, equipment and companion. */
  showModelFlair: boolean;
  onToggleShowModelFlair: () => void;
  /** Whether the time-of-day tint and the monitor/lamp glows are drawn. */
  cozyLighting: boolean;
  onToggleCozyLighting: () => void;
  externalAssetDirectories: string[];
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  /** ACTUAL install state (the hooksStatus message), not the hooksEnabled
   *  preference. The preference defaults to true while first-run consent is
   *  still pending, so binding the checkbox to it renders "on" over an empty
   *  ~/.claude/settings.json. */
  hooksInstalled: boolean;
  onToggleHooksEnabled: () => void;
  /** Whether the areas overlay is rendered outside of the Areas edit tool. */
  showAreas: boolean;
  onToggleShowAreas: () => void;
  /** Hide the Show Areas checkbox entirely when areas are unavailable. */
  showAreasAvailable: boolean;
  /** Browser-native layout export (standalone only; VS Code uses the host save dialog). */
  onExportLayout: () => void;
  /** Browser-native layout import from a chosen file (standalone only). */
  onImportLayout: (file: File) => void;
  /** Current token budgets (weighted tokens); undefined = unset. */
  tokenBudget5h?: number;
  tokenBudgetWeek?: number;
  /** Installed version, shown here instead of floating over the office. */
  version: string;
  onOpenChangelog: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  ghostHeadlessAgents,
  onToggleGhostHeadlessAgents,
  showModelFlair,
  onToggleShowModelFlair,
  cozyLighting,
  onToggleCozyLighting,
  externalAssetDirectories,
  watchAllSessions,
  onToggleWatchAllSessions,
  hooksInstalled,
  onToggleHooksEnabled,
  showAreas,
  onToggleShowAreas,
  showAreasAvailable,
  onExportLayout,
  onImportLayout,
  tokenBudget5h,
  tokenBudgetWeek,
  version,
  onOpenChangelog,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assetDirDraft, setAssetDirDraft] = useState('');
  const budget5hRef = useRef<HTMLInputElement>(null);
  const budgetWeekRef = useRef<HTMLInputElement>(null);

  // Both budgets travel together (a missing one means unset); the server ignores anything not positive.
  const sendBudgets = () => {
    const parse = (el: HTMLInputElement | null): number | undefined => {
      const n = Number(el?.value);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    transport.send({
      type: 'setTokenBudgets',
      budget5h: parse(budget5hRef.current),
      budgetWeek: parse(budgetWeekRef.current),
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" brand>
      {/* Open Sessions Folder opens an OS file manager — impossible in the browser. */}
      {!isBrowserRuntime && (
        <MenuItem
          onClick={() => {
            transport.send({ type: 'openSessionsFolder' });
            onClose();
          }}
        >
          Open Sessions Folder
        </MenuItem>
      )}
      <MenuItem
        onClick={() => {
          if (isBrowserRuntime) {
            onExportLayout();
          } else {
            transport.send({ type: 'exportLayout' });
          }
          onClose();
        }}
      >
        Export Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (isBrowserRuntime) {
            // Open the native file picker; the import is applied in onChange below.
            fileInputRef.current?.click();
          } else {
            transport.send({ type: 'importLayout' });
            onClose();
          }
        }}
      >
        Import Layout
      </MenuItem>
      {isBrowserRuntime && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset the value so re-selecting the same file fires change again.
            e.target.value = '';
            if (file) {
              onImportLayout(file);
              onClose();
            }
          }}
        />
      )}
      {/* Browser has no native directory picker, so accept a typed absolute path. */}
      {isBrowserRuntime ? (
        <div className="flex items-center gap-4 py-4 px-10">
          <input
            type="text"
            value={assetDirDraft}
            placeholder="Absolute asset directory path"
            onChange={(e) => setAssetDirDraft(e.target.value)}
            className="flex-1 min-w-0 text-xs py-2 px-4 bg-brand-paper-2 border-2 border-brand-ink rounded-none text-brand-ink"
          />
          <Button
            variant="brand"
            size="sm"
            onClick={() => {
              const path = assetDirDraft.trim();
              if (!path) return;
              transport.send({ type: 'addExternalAssetDirectory', path });
              setAssetDirDraft('');
            }}
            className="shrink-0"
          >
            Add
          </Button>
        </div>
      ) : (
        <MenuItem
          onClick={() => {
            transport.send({ type: 'addExternalAssetDirectory' });
            onClose();
          }}
        >
          Add Asset Directory
        </MenuItem>
      )}
      {externalAssetDirectories.map((dir) => (
        <div key={dir} className="flex items-center justify-between py-4 px-10 gap-8">
          <span
            className="text-xs opacity-70 overflow-hidden text-ellipsis whitespace-nowrap"
            title={dir}
          >
            {dir.split(/[/\\]/).pop() ?? dir}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => transport.send({ type: 'removeExternalAssetDirectory', path: dir })}
            className="shrink-0 text-brand-ink!"
          >
            x
          </Button>
        </div>
      ))}
      <Checkbox
        label="Sound Notifications"
        checked={soundLocal}
        onChange={() => {
          const newVal = !isSoundEnabled();
          setSoundEnabled(newVal);
          setSoundLocal(newVal);
          transport.send({ type: 'setSoundEnabled', enabled: newVal });
        }}
      />
      <Checkbox
        label="Watch All Sessions"
        checked={watchAllSessions}
        onChange={onToggleWatchAllSessions}
      />
      <Checkbox
        label="Instant Detection (Hooks)"
        checked={hooksInstalled}
        onChange={onToggleHooksEnabled}
      />
      {/* Headless agents are the office's only terminal-less citizens in VS Code.
          Standalone has no terminals at all, so nothing there would ever ghost. */}
      {!isBrowserRuntime && (
        <Checkbox
          label="Display Headless as Ghosts"
          checked={ghostHeadlessAgents}
          onChange={onToggleGhostHeadlessAgents}
        />
      )}
      <Checkbox
        label="Show Model Flair"
        checked={showModelFlair}
        onChange={onToggleShowModelFlair}
      />
      <Checkbox label="Cozy Lighting" checked={cozyLighting} onChange={onToggleCozyLighting} />
      {showAreasAvailable && (
        <Checkbox label="Show Areas" checked={showAreas} onChange={onToggleShowAreas} />
      )}
      <div className="py-4 px-10 text-xs opacity-70">
        Optional usage budgets (cost-weighted tokens)
      </div>
      {(
        [
          ['5 h budget', budget5hRef, tokenBudget5h],
          ['Week budget', budgetWeekRef, tokenBudgetWeek],
        ] as const
      ).map(([label, ref, value]) => (
        <label key={label} className="flex items-center justify-between gap-8 py-4 px-10 text-xs">
          {label}
          <input
            ref={ref}
            // Remount when the server confirms a new value, so the field shows what was saved.
            key={value ?? 'unset'}
            type="number"
            min={1}
            defaultValue={value ?? ''}
            placeholder="unset"
            onBlur={sendBudgets}
            className="w-120 min-w-0 text-xs py-2 px-4 bg-brand-paper-2 border-2 border-brand-ink rounded-none text-brand-ink"
          />
        </label>
      ))}
      <Checkbox label="Debug View" checked={isDebugMode} onChange={onToggleDebugMode} />
      {version && (
        <MenuItem
          onClick={() => {
            onOpenChangelog();
            onClose();
          }}
        >
          Version v{version} (what's new)
        </MenuItem>
      )}
    </Modal>
  );
}
