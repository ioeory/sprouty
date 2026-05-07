/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { cn } from './ui';

export interface SplitTargetLedger {
  id: string;
  name: string;
}

export interface SplitAllocation {
  /** Target personal sub-ledger id; '' = unselected */
  target_ledger_id: string;
  /** Raw user input so backspace / partial values feel natural */
  amount: string;
}

interface Props {
  /** Linked personal sub-ledgers of the source family ledger */
  targets: SplitTargetLedger[];
  /** Total expected amount (parsed from the parent form's "amount" field) */
  totalAmount: number;
  allocations: SplitAllocation[];
  onChange: (next: SplitAllocation[]) => void;
  /** Disabled state mirrors the surrounding form */
  disabled?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * SplitAllocationsEditor — owns the "which sub-ledger gets how much" grid.
 * Stateless in the sense that allocations live in the parent; this component
 * only renders + emits change events. Validation lives at submit time so the
 * user can freely edit numbers without seeing red errors mid-typing.
 */
export default function SplitAllocationsEditor({
  targets,
  totalAmount,
  allocations,
  onChange,
  disabled,
}: Props) {
  const { t } = useTranslation('modals');

  // Bootstrap one empty row when the user first enables splitting.
  useEffect(() => {
    if (allocations.length === 0 && targets.length > 0) {
      onChange([{ target_ledger_id: targets[0].id, amount: '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.length]);

  const allocated = useMemo(
    () =>
      allocations.reduce((s, a) => {
        const v = parseFloat(a.amount);
        return s + (Number.isFinite(v) ? v : 0);
      }, 0),
    [allocations],
  );
  const remaining = round2(totalAmount - allocated);
  const overAllocated = remaining < -0.005;
  const fullyAllocated = Math.abs(remaining) < 0.005 && totalAmount > 0;
  const usedTargets = new Set(allocations.map((a) => a.target_ledger_id).filter(Boolean));

  const updateRow = (idx: number, patch: Partial<SplitAllocation>) => {
    const next = allocations.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    onChange(next);
  };

  const addRow = () => {
    const free = targets.find((t) => !usedTargets.has(t.id));
    onChange([...allocations, { target_ledger_id: free?.id ?? '', amount: '' }]);
  };

  const removeRow = (idx: number) => {
    onChange(allocations.filter((_, i) => i !== idx));
  };

  /** Equally divide totalAmount among current rows (cents granularity, remainder to the first row). */
  const distributeEqually = () => {
    if (allocations.length === 0 || totalAmount <= 0) return;
    const totalCents = Math.round(totalAmount * 100);
    const base = Math.floor(totalCents / allocations.length);
    const rem = totalCents - base * allocations.length;
    const next = allocations.map((a, i) => {
      const cents = base + (i < rem ? 1 : 0);
      return { ...a, amount: (cents / 100).toFixed(2) };
    });
    onChange(next);
  };

  /** Set the last row's amount to totalAmount - sum(others). Useful "fill remaining" shortcut. */
  const fillLastRemaining = () => {
    if (allocations.length === 0 || totalAmount <= 0) return;
    const otherSum = allocations.slice(0, -1).reduce((s, a) => {
      const v = parseFloat(a.amount);
      return s + (Number.isFinite(v) ? v : 0);
    }, 0);
    const last = round2(totalAmount - otherSum);
    if (last <= 0) return;
    const next = allocations.map((a, i) =>
      i === allocations.length - 1 ? { ...a, amount: last.toFixed(2) } : a,
    );
    onChange(next);
  };

  return (
    <div className="space-y-2.5">
      {/* Summary bar */}
      <div className="flex items-center justify-between text-[11px] font-tabular">
        <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
          <span>{t('splitTotalLabel')} ¥{totalAmount.toFixed(2)}</span>
          <span>·</span>
          <span>{t('splitAllocatedLabel')} ¥{allocated.toFixed(2)}</span>
        </div>
        <div
          className={cn(
            'font-semibold',
            overAllocated
              ? 'text-[var(--color-danger)]'
              : fullyAllocated
                ? 'text-[var(--color-success)]'
                : 'text-[var(--color-text-muted)]',
          )}
        >
          {overAllocated
            ? t('splitOverBy', { amount: Math.abs(remaining).toFixed(2) })
            : fullyAllocated
              ? t('splitFullyAllocated')
              : t('splitRemaining', { amount: remaining.toFixed(2) })}
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || allocations.length === 0 || totalAmount <= 0}
          onClick={distributeEqually}
          className="px-2 py-1 text-[11px] rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('splitDistributeEqually')}
        </button>
        <button
          type="button"
          disabled={disabled || allocations.length === 0 || totalAmount <= 0}
          onClick={fillLastRemaining}
          className="px-2 py-1 text-[11px] rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('splitFillLast')}
        </button>
      </div>

      {/* Rows */}
      <div className="space-y-1.5">
        {allocations.map((row, idx) => {
          const otherUsed = new Set(
            allocations.filter((_, i) => i !== idx).map((a) => a.target_ledger_id).filter(Boolean),
          );
          return (
            <div key={idx} className="flex gap-1.5 items-center">
              <select
                disabled={disabled}
                value={row.target_ledger_id}
                onChange={(e) => updateRow(idx, { target_ledger_id: e.target.value })}
                className="flex-1 h-9 px-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
              >
                <option value="">{t('splitPickLedger')}</option>
                {targets.map((tg) => {
                  const used = otherUsed.has(tg.id);
                  return (
                    <option key={tg.id} value={tg.id} disabled={used}>
                      {tg.name}{used ? ` (${t('splitLedgerUsed')})` : ''}
                    </option>
                  );
                })}
              </select>
              <div className="relative w-28 shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)] text-xs">¥</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={disabled}
                  value={row.amount}
                  onChange={(e) => updateRow(idx, { amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full h-9 pl-5 pr-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-tabular text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
                />
              </div>
              <button
                type="button"
                disabled={disabled || allocations.length <= 1}
                onClick={() => removeRow(idx)}
                title={t('splitRemoveRow')}
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={disabled || allocations.length >= targets.length}
        onClick={addRow}
        className="inline-flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
      >
        <Plus size={11} /> {t('splitAddRow')}
      </button>
    </div>
  );
}

/** Validate allocations against an expected total. Returns null on success or a translation key on error. */
export function validateAllocations(
  allocations: SplitAllocation[],
  totalAmount: number,
): { ok: true } | { ok: false; key: 'splitErrEmpty' | 'splitErrMissingLedger' | 'splitErrAmountInvalid' | 'splitErrSumMismatch' | 'splitErrDuplicateLedger' } {
  if (allocations.length === 0) return { ok: false, key: 'splitErrEmpty' };
  let sumCents = 0;
  const seen = new Set<string>();
  for (const a of allocations) {
    if (!a.target_ledger_id) return { ok: false, key: 'splitErrMissingLedger' };
    if (seen.has(a.target_ledger_id)) return { ok: false, key: 'splitErrDuplicateLedger' };
    seen.add(a.target_ledger_id);
    const v = parseFloat(a.amount);
    if (!Number.isFinite(v) || v <= 0) return { ok: false, key: 'splitErrAmountInvalid' };
    sumCents += Math.round(v * 100);
  }
  const totalCents = Math.round(totalAmount * 100);
  if (Math.abs(sumCents - totalCents) > 1) return { ok: false, key: 'splitErrSumMismatch' };
  return { ok: true };
}
