import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/client';
import { dateInputValueToISO, formatLocalDateForInput } from '../lib/dateLocal';
import {
  Modal,
  Button,
  Input,
  CategoryIcon,
  ICON_NAMES,
  CATEGORY_COLORS,
  cn,
} from './ui';

export interface ProjectFormInitial {
  id?: string;
  name?: string;
  icon?: string;
  color?: string;
  note?: string;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
}

interface Props {
  open: boolean;
  ledgerId: string;
  initial?: ProjectFormInitial;
  onClose: () => void;
  onSuccess: (projectId?: string) => void;
}

const toDateInput = (v?: string | null) => (v ? formatLocalDateForInput(new Date(v)) : '');

export default function ProjectFormModal({ open, ledgerId, initial, onClose, onSuccess }: Props) {
  const { t } = useTranslation('modals');
  const { t: tc } = useTranslation('common');
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'Briefcase');
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLORS[11]);
  const [note, setNote] = useState(initial?.note ?? '');
  const [startDate, setStartDate] = useState(toDateInput(initial?.start_date));
  const [endDate, setEndDate] = useState(toDateInput(initial?.end_date));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setIcon(initial?.icon ?? 'Briefcase');
      setColor(initial?.color ?? CATEGORY_COLORS[11]);
      setNote(initial?.note ?? '');
      setStartDate(toDateInput(initial?.start_date));
      setEndDate(toDateInput(initial?.end_date));
      setError('');
    }
  }, [open, initial?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('projectNameRequired'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        ledger_id: ledgerId,
        icon,
        color,
        note,
        start_date: startDate ? dateInputValueToISO(startDate) : null,
        end_date: endDate ? dateInputValueToISO(endDate) : null,
      };
      let res;
      if (isEdit && initial?.id) {
        res = await api.put(`/projects/${initial.id}`, payload);
      } else {
        payload.budget_mode = 'none';
        res = await api.post('/projects', payload);
      }
      onSuccess(res.data?.id || initial?.id || '');
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || t('projectSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('projectEditTitle') : t('projectCreateTitle')}
      description={isEdit ? t('projectEditDesc') : t('projectCreateDesc')}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
          <CategoryIcon name={icon} color={color} size={48} />
          <div className="flex-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('projectNamePlaceholder')}
              autoFocus
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">{t('color')}</p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                className={cn(
                  'w-7 h-7 rounded-full border-2 transition-all',
                  color === c ? 'border-[var(--color-text)] scale-110' : 'border-transparent hover:scale-105',
                )}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">{t('icon')}</p>
          <div className="grid grid-cols-8 gap-1.5 max-h-44 overflow-y-auto p-1">
            {ICON_NAMES.map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => setIcon(n)}
                className={cn(
                  'p-1.5 rounded-[var(--radius-sm)] border transition-all',
                  icon === n
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                    : 'border-transparent hover:bg-[var(--color-surface-muted)]',
                )}
                title={n}
              >
                <CategoryIcon name={n} color={color} size={32} />
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">{t('startDate')}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">{t('endDate')}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">{t('remark')}</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t('remarkPlaceholder')}
            className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
          />
        </div>

        {error && (
          <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" fullWidth onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={loading} fullWidth>
            {isEdit ? t('saveProjectEdit') : t('createProject')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
