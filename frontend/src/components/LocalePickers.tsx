import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './ui';

function useCloseOnOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open, onClose]);
  return ref;
}

function clampYm(y: number, m: number): { y: number; m: number } {
  if (m < 1) return { y: y - 1, m: 12 };
  if (m > 12) return { y: y + 1, m: 1 };
  return { y, m };
}

type MonthFieldBase = {
  value: string;
  onChange: (ym: string) => void;
  max?: string;
  min?: string;
  className?: string;
  allowClear?: boolean;
};

/** Native month input (non-zh). Own component so parent does not conditionally call hooks. */
function LocaleMonthFieldNative({ value, onChange, max, min, className }: MonthFieldBase) {
  return (
    <input
      type="month"
      lang="en"
      value={value}
      max={max}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  );
}

/** zh-CN month grid — hooks live only here; stable across renders of this component type. */
function LocaleMonthFieldZh({
  value,
  onChange,
  max,
  min,
  className,
  allowClear = true,
}: MonthFieldBase) {
  const { t } = useTranslation('common');

  const parsed = value.match(/^(\d{4})-(\d{2})$/);
  const vy = parsed ? parseInt(parsed[1], 10) : new Date().getFullYear();
  const vm = parsed ? parseInt(parsed[2], 10) : new Date().getMonth() + 1;

  const maxYm = max?.slice(0, 7);
  const minYm = min?.slice(0, 7);

  const canSelectYm = (ym: string) => {
    if (maxYm && ym > maxYm) return false;
    if (minYm && ym < minYm) return false;
    return true;
  };

  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(vy);
  const wrapRef = useCloseOnOutside(open, () => setOpen(false));

  useEffect(() => {
    const m = value.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      setViewY(parseInt(m[1], 10));
    }
  }, [value]);

  const label = useMemo(() => {
    if (!value) return t('calendarPickMonth');
    try {
      return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date(vy, vm - 1, 1));
    } catch {
      return `${vy}年${vm}月`;
    }
  }, [value, vy, vm, t]);

  const yearMax = maxYm ? parseInt(maxYm.slice(0, 4), 10) : new Date().getFullYear() + 10;
  const yearMin = minYm ? parseInt(minYm.slice(0, 4), 10) : 2000;
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = yearMin; y <= yearMax; y++) out.push(y);
    return out;
  }, [yearMin, yearMax]);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'h-10 w-full min-w-[10rem] px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text)] text-left font-tabular outline-none focus:border-[var(--color-brand)]',
          className,
        )}
        aria-haspopup="dialog"
      >
        {label}
      </button>
      {open && (
        <div className="absolute z-[80] mt-1 left-0 min-w-[240px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <select
              value={viewY}
              onChange={(e) => setViewY(Number(e.target.value))}
              className="flex-1 h-9 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-xs text-[var(--color-text)] outline-none"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 12 }, (_, i) => {
              const mo = i + 1;
              const ym = `${viewY}-${String(mo).padStart(2, '0')}`;
              const ok = canSelectYm(ym);
              const active = value.slice(0, 7) === ym;
              return (
                <button
                  key={mo}
                  type="button"
                  disabled={!ok}
                  onClick={() => {
                    onChange(ym);
                    setOpen(false);
                  }}
                  className={cn(
                    'h-8 rounded-[var(--radius-sm)] text-xs transition-colors',
                    active
                      ? 'border border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                      : ok
                        ? 'border border-transparent hover:bg-[var(--color-surface-muted)] text-[var(--color-text)]'
                        : 'opacity-40 cursor-not-allowed text-[var(--color-text-muted)]',
                  )}
                >
                  {mo}月
                </button>
              );
            })}
          </div>
          <div className="flex justify-between gap-2 mt-3 pt-2 border-t border-[var(--color-border)]">
            {allowClear ? (
              <button
                type="button"
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                {t('calendarClear')}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="text-xs text-[var(--color-brand)] hover:underline"
              onClick={() => {
                const now = new Date();
                const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                if (canSelectYm(cur)) {
                  onChange(cur);
                  setViewY(now.getFullYear());
                  setOpen(false);
                }
              }}
            >
              {t('calendarThisMonth')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Month field: delegates to native input or Chinese UI in **separate child components**
 * so hook counts never change when i18n language toggles (fixes React #310).
 */
export function LocaleMonthField(props: MonthFieldBase) {
  const { i18n } = useTranslation('common');
  if (i18n.language.startsWith('zh')) {
    return <LocaleMonthFieldZh {...props} />;
  }
  return <LocaleMonthFieldNative {...props} />;
}

function isoFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseIsoDate(s: string): { y: number; m: number; d: number } | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

type DateFieldBase = {
  value: string;
  onChange: (ymd: string) => void;
  max?: string;
  min?: string;
  className?: string;
};

function LocaleDateFieldNative({ value, onChange, max, min, className }: DateFieldBase) {
  return (
    <input
      type="date"
      lang="en"
      value={value}
      max={max}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  );
}

function LocaleDateFieldZh({ value, onChange, max, min, className }: DateFieldBase) {
  const { t } = useTranslation('common');

  const p = value ? parseIsoDate(value) : null;
  const now = new Date();
  const initialY = p?.y ?? now.getFullYear();
  const initialM = p?.m ?? now.getMonth() + 1;
  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(initialY);
  const [viewM, setViewM] = useState(initialM);
  const wrapRef = useCloseOnOutside(open, () => setOpen(false));

  useEffect(() => {
    if (p) {
      setViewY(p.y);
      setViewM(p.m);
    }
  }, [value, p]);

  const label = useMemo(() => {
    if (!value || !p) return t('calendarPickDate');
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }).format(new Date(p.y, p.m - 1, p.d));
    } catch {
      return value;
    }
  }, [value, p, t]);

  const weekdays = t('calendarWeekdays', { returnObjects: true }) as string[];

  const canPickDay = (y: number, m: number, d: number) => {
    const iso = isoFromParts(y, m, d);
    if (min && iso < min) return false;
    if (max && iso > max) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  };

  const shiftMonth = (delta: number) => {
    const { y, m } = clampYm(viewY, viewM + delta);
    setViewY(y);
    setViewM(m);
  };

  const firstDow = new Date(viewY, viewM - 1, 1).getDay();
  const daysInMonth = new Date(viewY, viewM, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  const today = formatLocalToday();

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm font-tabular text-left outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20',
          className,
        )}
        aria-haspopup="dialog"
      >
        {label}
      </button>
      {open && (
        <div className="absolute z-[80] mt-1 left-0 min-w-[280px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button type="button" className="p-1 rounded hover:bg-[var(--color-surface-muted)]" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={18} className="text-[var(--color-text-muted)]" />
            </button>
            <span className="text-xs font-medium text-[var(--color-text)]">
              {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date(viewY, viewM - 1, 1))}
            </span>
            <button type="button" className="p-1 rounded hover:bg-[var(--color-surface-muted)]" onClick={() => shiftMonth(1)}>
              <ChevronRight size={18} className="text-[var(--color-text-muted)]" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-[var(--color-text-muted)] mb-1">
            {weekdays.map((w) => (
              <span key={w}>
                {w}
              </span>
            ))}
          </div>
          {rows.map((row, ri) => (
            <div key={ri} className="grid grid-cols-7 gap-0.5">
              {row.map((d, di) =>
                d === null ? (
                  <span key={`e-${di}`} className="h-8" />
                ) : (
                  <button
                    key={d}
                    type="button"
                    disabled={!canPickDay(viewY, viewM, d)}
                    onClick={() => {
                      onChange(isoFromParts(viewY, viewM, d));
                      setOpen(false);
                    }}
                    className={cn(
                      'h-8 rounded-[var(--radius-sm)] text-xs font-tabular transition-colors',
                      value === isoFromParts(viewY, viewM, d)
                        ? 'border border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                        : canPickDay(viewY, viewM, d)
                          ? 'hover:bg-[var(--color-surface-muted)] text-[var(--color-text)]'
                          : 'opacity-30 cursor-not-allowed text-[var(--color-text-muted)]',
                      today === isoFromParts(viewY, viewM, d) && value !== isoFromParts(viewY, viewM, d)
                        ? 'ring-1 ring-[var(--color-border)]'
                        : '',
                    )}
                  >
                    {d}
                  </button>
                ),
              )}
            </div>
          ))}
          <div className="flex justify-between gap-2 mt-3 pt-2 border-t border-[var(--color-border)]">
            <button
              type="button"
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {t('calendarClear')}
            </button>
            <button
              type="button"
              className="text-xs text-[var(--color-brand)] hover:underline"
              onClick={() => {
                const tp = parseIsoDate(today);
                if (tp && canPickDay(tp.y, tp.m, tp.d)) {
                  onChange(today);
                  setViewY(tp.y);
                  setViewM(tp.m);
                  setOpen(false);
                }
              }}
            >
              {t('calendarToday')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatLocalToday(): string {
  const n = new Date();
  return isoFromParts(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function LocaleDateField(props: DateFieldBase) {
  const { i18n } = useTranslation('common');
  if (i18n.language.startsWith('zh')) {
    return <LocaleDateFieldZh {...props} />;
  }
  return <LocaleDateFieldNative {...props} />;
}
