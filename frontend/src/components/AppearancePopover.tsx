import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { ThemeToggle } from './ui/ThemeToggle';
import { cn } from './ui/cn';

/**
 * Site appearance: light/dark/auto + color palette (stored in localStorage).
 */
export default function AppearancePopover({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const { palette, setPalette } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('appearance')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        <Palette size={16} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 w-[min(20rem,calc(100vw-2rem))] p-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg z-50 animate-slide-up"
          role="dialog"
          aria-label={t('appearance')}
        >
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">{t('appearance')}</p>
          <p className="text-[10px] text-[var(--color-text-subtle)] mb-2">{t('appearanceThemeHint')}</p>
          <ThemeToggle className="w-full flex-wrap justify-center" />
          <p className="text-xs font-medium text-[var(--color-text-muted)] mt-4 mb-2">{t('palette')}</p>
          <p className="text-[10px] text-[var(--color-text-subtle)] mb-2">{t('paletteHint')}</p>
          <div className="flex gap-1.5">
            {(['default', 'green'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPalette(p)}
                className={cn(
                  'flex-1 h-8 rounded-[var(--radius-sm)] text-xs font-medium border transition-colors',
                  palette === p
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]',
                )}
              >
                {p === 'default' ? t('palette_default') : t('palette_green')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
