import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from './cn';

export interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
}

interface SidebarProps {
  brand: React.ReactNode;
  brandCollapsed?: React.ReactNode;
  items: NavItem[];
  footer?: React.ReactNode;
  footerCollapsed?: React.ReactNode;
  className?: string;
  /** Mobile drawer state (only effective under `lg`) */
  open: boolean;
  onClose: () => void;
  /** Desktop collapsed state (only effective `>= lg`) */
  collapsed: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  brand,
  brandCollapsed,
  items,
  footer,
  footerCollapsed,
  className,
  open,
  onClose,
  collapsed,
}) => {
  // Close the mobile drawer on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const widthCls = collapsed ? 'lg:w-16' : 'lg:w-60';
  const translateCls = open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0';

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden animate-fade-in"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-60 flex flex-col shrink-0 transition-all duration-200 ease-out',
          'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:z-auto',
          translateCls,
          widthCls,
          'bg-[var(--color-surface)] border-r border-[var(--color-border)]',
          className,
        )}
        aria-label="主导航"
      >
        <div
          className={cn(
            'h-14 flex items-center border-b border-[var(--color-border)]',
            collapsed ? 'lg:justify-center lg:px-0 px-5' : 'px-5',
          )}
        >
          <div className={cn('w-full', collapsed && 'lg:hidden')}>{brand}</div>
          {collapsed && <div className="hidden lg:block">{brandCollapsed ?? brand}</div>}
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 h-9 rounded-[var(--radius-md)] text-sm transition-all',
                  collapsed ? 'lg:justify-center lg:px-0 px-3' : 'px-3',
                  isActive
                    ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)] font-medium'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]',
                )
              }
            >
              <span className="shrink-0">{item.icon}</span>
              <span className={cn('flex-1 truncate', collapsed && 'lg:hidden')}>{item.label}</span>
              {!collapsed && item.badge}
            </NavLink>
          ))}
        </nav>

        {footer && (
          <div
            className={cn(
              'border-t border-[var(--color-border)]',
              collapsed ? 'lg:p-2 p-3' : 'p-3',
            )}
          >
            <div className={cn(collapsed && 'lg:hidden')}>{footer}</div>
            {collapsed && <div className="hidden lg:block">{footerCollapsed ?? footer}</div>}
          </div>
        )}
      </aside>
    </>
  );
};
