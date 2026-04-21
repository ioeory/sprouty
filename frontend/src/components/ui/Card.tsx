import React from 'react';
import { cn } from './cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

const paddingMap = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export const Card: React.FC<CardProps> = ({ padding = 'md', interactive, className, children, ...rest }) => (
  <div
    className={cn(
      'rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card',
      interactive && 'transition-all hover:border-[var(--color-border-strong)] hover:shadow-card-hover cursor-pointer',
      paddingMap[padding],
      className,
    )}
    {...rest}
  >
    {children}
  </div>
);

interface SectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export const CardHeader: React.FC<SectionProps> = ({ title, description, action, icon, className, children, ...rest }) => (
  <div className={cn('flex items-start justify-between gap-4', className)} {...rest}>
    <div className="flex items-start gap-3 min-w-0">
      {icon && (
        <div className="mt-0.5 shrink-0 w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        {title && <h3 className="text-sm font-semibold text-[var(--color-text)] leading-tight">{title}</h3>}
        {description && <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">{description}</p>}
        {children}
      </div>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
