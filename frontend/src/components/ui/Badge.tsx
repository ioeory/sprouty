import React from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'info';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

const toneStyles: Record<Tone, string> = {
  neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
  brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
  success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
};

const dotTones: Record<Tone, string> = {
  neutral: 'bg-[var(--color-text-subtle)]',
  brand: 'bg-[var(--color-brand)]',
  success: 'bg-[var(--color-success)]',
  danger: 'bg-[var(--color-danger)]',
  warning: 'bg-[var(--color-warning)]',
  info: 'bg-[var(--color-info)]',
};

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', dot, className, children, ...rest }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
      toneStyles[tone],
      className,
    )}
    {...rest}
  >
    {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dotTones[tone])} />}
    {children}
  </span>
);
