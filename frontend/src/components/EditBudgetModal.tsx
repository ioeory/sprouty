import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Target } from 'lucide-react';
import api from '../api/client';
import { Button, Modal } from './ui';

interface Props {
  open: boolean;
  ledgerId: string;
  /** Effective budget for this month (override or default), shown in the input. */
  currentBudget: number;
  /** Calendar month of this override (YYYY-MM). */
  yearMonth: string;
  /** Ledger default when no month row exists (informational). */
  defaultMonthlyBudget?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditBudgetModal({
  open,
  ledgerId,
  currentBudget,
  yearMonth,
  defaultMonthlyBudget,
  onClose,
  onSuccess,
}: Props) {
  const { t } = useTranslation('modals');
  const { t: tc } = useTranslation('common');
  const [amount, setAmount] = useState(currentBudget ? currentBudget.toString() : '');
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setAmount(currentBudget ? String(currentBudget) : '');
    setError('');
  }, [open, currentBudget]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    setError('');
    setLoading(true);
    try {
      await api.post('/budgets', {
        ledger_id: ledgerId,
        amount: parseFloat(amount),
        year_month: yearMonth,
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('updateBudgetFailed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClearOverride = async () => {
    setError('');
    setClearing(true);
    try {
      await api.delete(`/budgets/month-override?ledger_id=${encodeURIComponent(ledgerId)}&year_month=${encodeURIComponent(yearMonth)}`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 404) {
        setError(t('editBudgetNoOverride'));
      } else {
        setError(e.response?.data?.error || t('updateBudgetFailed'));
      }
    } finally {
      setClearing(false);
    }
  };

  const presets = [3000, 5000, 8000, 10000, 15000, 20000];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <Target size={16} className="text-[var(--color-brand)]" />
          {t('editBudgetTitle')}
        </span>
      }
      description={t('editBudgetDesc')}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {defaultMonthlyBudget != null && defaultMonthlyBudget > 0 && (
          <p className="text-[11px] text-[var(--color-text-subtle)] leading-relaxed">
            {t('editBudgetDefaultHint', { amount: defaultMonthlyBudget.toLocaleString() })}
          </p>
        )}
        <div className="space-y-2">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)] text-xl font-semibold">¥</span>
            <input
              type="number"
              step="100"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full pl-10 pr-4 py-4 text-3xl font-semibold font-tabular text-center text-[var(--color-text)] bg-[var(--color-surface-muted)] rounded-[var(--radius-lg)] border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20 transition-all"
              required
              autoFocus
            />
          </div>
          <p className="text-[10px] text-center text-[var(--color-text-subtle)]">{yearMonth}</p>
          <div className="flex flex-wrap gap-1.5 pt-1 justify-center">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p.toString())}
                className="px-2.5 py-1 text-xs rounded-full bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand)] transition-colors"
              >
                ¥{p.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button type="button" variant="outline" fullWidth onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={loading} fullWidth>
              {t('saveBudget')}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" loading={clearing} onClick={() => void handleClearOverride()}>
            {t('editBudgetClearOverride')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
