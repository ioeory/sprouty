import React, { useState } from 'react';
import { Target } from 'lucide-react';
import api from '../api/client';
import { Button, Modal } from './ui';

interface Props {
  open: boolean;
  ledgerId: string;
  currentBudget: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditBudgetModal({ open, ledgerId, currentBudget, onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState(currentBudget ? currentBudget.toString() : '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    setError('');
    setLoading(true);
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await api.post('/budgets', {
        ledger_id: ledgerId,
        amount: parseFloat(amount),
        year_month: yearMonth,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || '更新预算失败');
    } finally {
      setLoading(false);
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
          设置本月预算
        </span>
      }
      description="控制开销从设定边界开始"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
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

        <div className="flex gap-2">
          <Button type="button" variant="outline" fullWidth onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={loading} fullWidth>
            保存预算
          </Button>
        </div>
      </form>
    </Modal>
  );
}
