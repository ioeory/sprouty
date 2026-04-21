import React from 'react';
import { cn } from './cn';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className }) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center text-center py-10 px-6 gap-3',
      className,
    )}
  >
    {icon && (
      <div className="w-12 h-12 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)] flex items-center justify-center">
        {icon}
      </div>
    )}
    <div className="space-y-1 max-w-xs">
      <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
      {description && <p className="text-xs text-[var(--color-text-subtle)] leading-relaxed">{description}</p>}
    </div>
    {action}
  </div>
);
