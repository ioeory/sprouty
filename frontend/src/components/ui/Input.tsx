import React from 'react';
import { cn } from './cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, leftIcon, rightSlot, className, id, ...rest }, ref) => {
    const inputId = id || rest.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-[var(--color-text-muted)] flex items-center gap-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)] pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full h-10 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm',
              'placeholder:text-[var(--color-text-subtle)] font-tabular',
              'transition-all duration-150 outline-none',
              'focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20',
              'disabled:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed',
              leftIcon ? 'pl-9' : 'pl-3',
              rightSlot ? 'pr-10' : 'pr-3',
              error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
              className,
            )}
            {...rest}
          />
          {rightSlot && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {rightSlot}
            </span>
          )}
        </div>
        {(hint || error) && (
          <p className={cn(
            'text-xs',
            error ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-subtle)]',
          )}>
            {error || hint}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
