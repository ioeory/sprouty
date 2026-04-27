import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemeMode } from '../ThemeProvider';
import { cn } from './cn';

interface Item {
  value: ThemeMode;
  label: string;
  icon: React.ReactNode;
}

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false, className }) => {
  const { t } = useTranslation('common');
  const { mode, setMode } = useTheme();
  const items = React.useMemo<Item[]>(
    () => [
      { value: 'auto', label: t('theme_auto'), icon: <Monitor size={14} /> },
      { value: 'light', label: t('theme_light'), icon: <Sun size={14} /> },
      { value: 'dark', label: t('theme_dark'), icon: <Moon size={14} /> },
    ],
    [t],
  );

  return (
    <div
      role="radiogroup"
      aria-label={t('theme')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5',
        className,
      )}
    >
      {items.map((item) => {
        const active = mode === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${t('theme')}：${item.label}`}
            onClick={() => setMode(item.value)}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-sm)] text-xs font-medium transition-colors',
              active
                ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                : 'text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]',
            )}
          >
            {item.icon}
            {!compact && <span>{item.label}</span>}
          </button>
        );
      })}
    </div>
  );
};
