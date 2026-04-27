import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
};

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/30 backdrop-blur-[2px] animate-fade-in overflow-y-auto overscroll-contain"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full my-auto flex max-h-[min(92dvh,calc(100dvh-1.5rem))] flex-col rounded-[var(--radius-xl)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg overflow-hidden animate-scale-in',
          sizeMap[size],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="shrink-0 px-6 pt-5 pb-4 border-b border-[var(--color-border)] flex items-start justify-between gap-4">
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>}
              {description && <p className="text-xs text-[var(--color-text-subtle)] mt-1">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 px-6 py-4 bg-[var(--color-surface-muted)]/50 border-t border-[var(--color-border)] flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
