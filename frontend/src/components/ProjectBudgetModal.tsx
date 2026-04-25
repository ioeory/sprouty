import React, { useEffect, useState } from 'react';
import { Wallet, Trash2 } from 'lucide-react';
import api from '../api/client';
import { Modal, Button, Select, cn } from './ui';

export interface ProjectBudgetInitial {
  id: string;
  name: string;
  ledger_id: string;
  budget?: {
    mode: 'none' | 'total' | 'monthly';
    amount: number;
    year_month?: string;
    ledger_id?: string;
  };
}

interface Props {
  open: boolean;
  project: ProjectBudgetInitial;
  onClose: () => void;
  onSuccess: () => void;
}

const MODE_OPTIONS: Array<{ value: 'none' | 'total' | 'monthly'; label: string; hint: string }> = [
  { value: 'none', label: '不设预算', hint: '只跟踪支出，不比较上限' },
  { value: 'total', label: '一次性总预算', hint: '适合有始有终的项目，如旅行、装修' },
  { value: 'monthly', label: '每月预算', hint: '按月重置，适合长期订阅类项目' },
];

export default function ProjectBudgetModal({ open, project, onClose, onSuccess }: Props) {
  const initMode = project.budget?.mode ?? 'none';
  const [mode, setMode] = useState<'none' | 'total' | 'monthly'>(initMode);
  const [amount, setAmount] = useState(
    project.budget && project.budget.mode !== 'none' ? String(project.budget.amount || '') : '',
  );
  const [yearMonth, setYearMonth] = useState(
    project.budget?.year_month || new Date().toISOString().slice(0, 7),
  );
  const [budgetLedgerId, setBudgetLedgerId] = useState(
    project.budget?.ledger_id || project.ledger_id || '',
  );
  const [ledgers, setLedgers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    void api
      .get('/ledgers')
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setLedgers(list.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })));
      })
      .catch(() => setLedgers([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const m = project.budget?.mode ?? 'none';
    setMode(m);
    setAmount(project.budget && m !== 'none' ? String(project.budget.amount || '') : '');
    setYearMonth(project.budget?.year_month || new Date().toISOString().slice(0, 7));
    setBudgetLedgerId(project.budget?.ledger_id || project.ledger_id || '');
    setError('');
  }, [open, project.id, project.ledger_id, project.budget?.ledger_id, project.budget?.mode]);

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      if (mode === 'none') {
        await api.delete(`/projects/${project.id}/budget`);
      } else {
        const payload: Record<string, unknown> = {
          mode,
          amount: parseFloat(amount) || 0,
          ledger_id: budgetLedgerId || project.ledger_id,
        };
        if (mode === 'monthly') payload.year_month = yearMonth;
        await api.put(`/projects/${project.id}/budget`, payload);
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="项目预算"
      description={project.name}
      size="md"
    >
      <div className="space-y-5">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">预算模式</p>
          <div className="space-y-2">
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={cn(
                    'w-full text-left p-3 rounded-[var(--radius-md)] border transition-all',
                    active
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]',
                  )}
                >
                  <p className={cn('text-sm font-medium', active ? 'text-[var(--color-brand)]' : 'text-[var(--color-text)]')}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">{opt.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        {mode !== 'none' && (
          <div className="space-y-3">
            <Select
              label="预算统计账本"
              hint="仅统计该账本下、关联本项目的支出，用于对比预算上限"
              value={budgetLedgerId}
              onChange={(e) => setBudgetLedgerId(e.target.value)}
            >
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)] flex items-center gap-1.5">
                <Wallet size={12} /> 金额
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)] text-sm">¥</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-10 pl-7 pr-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm font-tabular outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                />
              </div>
            </div>

            {mode === 'monthly' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-muted)]">适用月份</label>
                <input
                  type="month"
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                  className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                />
                <p className="text-[11px] text-[var(--color-text-subtle)]">切换到其它月份时再打开本弹窗单独设置</p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" fullWidth onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            fullWidth
            loading={loading}
            leftIcon={mode === 'none' ? <Trash2 size={14} /> : undefined}
            variant={mode === 'none' ? 'danger' : 'primary'}
            onClick={handleSave}
          >
            {mode === 'none' ? '清除预算' : '保存预算'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
