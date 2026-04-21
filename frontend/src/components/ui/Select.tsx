import React from 'react';
import { cn } from './cn';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, error, className, id, children, ...rest }, ref) => {
    const selectId = id || rest.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="text-xs font-medium text-[var(--color-text-muted)]">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full h-10 px-3 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm',
            'transition-all duration-150 outline-none cursor-pointer',
            'focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20',
            error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        {(hint || error) && (
          <p className={cn('text-xs', error ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-subtle)]')}>
            {error || hint}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';
