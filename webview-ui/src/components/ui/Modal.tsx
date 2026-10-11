import type { ReactNode } from 'react';

import { Button } from './Button.js';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** z-index for backdrop (modal gets +1). Default 49 */
  zIndex?: number;
  className?: string;
  /** Paper panel with ink border and hard shadow, for modals whose content is styled for it. */
  brand?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  zIndex = 50,
  className = '',
  brand = false,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50" style={{ zIndex }} onClick={onClose} />
      <div
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-4 min-w-xs ${
          brand ? 'brand-panel' : 'bg-bg border-2 border-border rounded-none shadow-pixel'
        } ${className}`}
        style={{ zIndex: zIndex + 1 }}
      >
        <div
          className={`flex items-center justify-between py-4 px-10 border-b mb-4 ${
            brand ? 'border-brand-ink' : 'border-border'
          }`}
        >
          <span className={`text-2xl ${brand ? 'text-brand-rust' : 'text-accent-bright'}`}>
            {title}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className={brand ? 'text-brand-ink! hover:text-brand-rust!' : ''}
          >
            x
          </Button>
        </div>
        {children}
      </div>
    </>
  );
}
