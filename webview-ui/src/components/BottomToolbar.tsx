import { type ReactNode, useEffect, useRef, useState } from 'react';

import { BOTTOM_BAR_IDLE_HIDE_MS } from '../constants.js';
import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { PixelWarn } from '../office/components/PixelIcons.js';
import { isBrowserRuntime } from '../runtime.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  isUsageOpen: boolean;
  onToggleUsage: () => void;
  workspaceFolders: WorkspaceFolder[];
  /** The zoom controls, at the bar's left end (none in debug view). */
  zoomControls?: ReactNode;
  privacy: boolean;
  onTogglePrivacy: () => void;
}

export function BottomToolbar({
  isEditMode,
  onOpenClaude,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  isUsageOpen,
  onToggleUsage,
  workspaceFolders,
  zoomControls,
  privacy,
  onTogglePrivacy,
}: BottomToolbarProps) {
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    pendingBypassRef.current = false;
    transport.send({ type: 'launchAgent', folderPath: folder.path, bypassPermissions });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      transport.send({ type: 'launchAgent', bypassPermissions });
    }
  };

  // The bar steps out of the way of the office: it fades after a while without the pointer
  // moving over the stage and comes back on the next move. A plain timer, no frame loop. It stays
  // while the pointer is on it, while a menu or panel it opened is open, and in edit mode.
  const barRef = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const pinned =
    isEditMode ||
    isSettingsOpen ||
    isUsageOpen ||
    isFolderPickerOpen ||
    isBypassMenuOpen ||
    hovered ||
    keyboardFocus;
  useEffect(() => {
    const stage = barRef.current?.parentElement;
    let timer: number | undefined;
    const setIdleOnce = (next: boolean) => {
      if (idleRef.current === next) return;
      idleRef.current = next;
      setIdle(next);
    };
    const arm = () => {
      window.clearTimeout(timer);
      if (!pinned) timer = window.setTimeout(() => setIdleOnce(true), BOTTOM_BAR_IDLE_HIDE_MS);
    };
    const onMove = () => {
      setIdleOnce(false);
      arm();
    };
    arm();
    stage?.addEventListener('pointermove', onMove);
    return () => {
      window.clearTimeout(timer);
      stage?.removeEventListener('pointermove', onMove);
    };
  }, [pinned]);
  const hidden = idle && !pinned;

  return (
    <div
      ref={barRef}
      data-testid="bottom-toolbar"
      data-hidden={hidden}
      className="stage-bar"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(e) => setKeyboardFocus(e.target.matches(':focus-visible'))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false);
      }}
    >
      <div className="bar-left">{zoomControls}</div>
      <div className="bar-right">
        <div className="bar-keys">
          <span>
            <kbd>{'\u2190'}</kbd>
            <kbd>{'\u2192'}</kbd>
            select
          </span>
          <span>
            <kbd>Enter</kbd>
            inspect
          </span>
          <button
            type="button"
            aria-pressed={privacy}
            onClick={(e) => {
              onTogglePrivacy();
              if (e.detail > 0) e.currentTarget.blur();
            }}
          >
            <kbd>P</kbd>
            hide text
          </button>
        </div>
        {/* Hide + Agent in standalone browser mode (no terminal to interact with) */}
        {!isBrowserRuntime && (
          <div
            ref={folderPickerRef}
            className="relative"
            onMouseEnter={handleAgentHover}
            onMouseLeave={handleAgentLeave}
          >
            <Button
              variant={isFolderPickerOpen || isBypassMenuOpen ? 'brandActive' : 'brand'}
              onClick={handleAgentClick}
            >
              + Agent
            </Button>
            <Dropdown isOpen={isBypassMenuOpen}>
              <DropdownItem onClick={() => handleBypassSelect(true)}>
                Skip permissions mode{' '}
                <span className="inline-flex text-warning">
                  <PixelWarn px={2} />
                </span>
              </DropdownItem>
            </Dropdown>
            <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
              {workspaceFolders.map((folder) => (
                <DropdownItem
                  key={folder.path}
                  onClick={() => handleFolderSelect(folder)}
                  className="text-base"
                >
                  {folder.name}
                </DropdownItem>
              ))}
            </Dropdown>
          </div>
        )}
        <Button
          variant={isEditMode ? 'brandActive' : 'brand'}
          onClick={onToggleEditMode}
          title="Edit office layout"
        >
          Layout
        </Button>
        <Button
          variant={isUsageOpen ? 'brandActive' : 'brand'}
          onClick={onToggleUsage}
          title="Token usage"
        >
          Usage
        </Button>
        <Button
          variant={isSettingsOpen ? 'brandActive' : 'brand'}
          onClick={onToggleSettings}
          title="Settings"
        >
          Settings
        </Button>
      </div>
    </div>
  );
}
