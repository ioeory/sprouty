import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, ArrowDown, ArrowUp, Loader2, FolderKanban, Tag as TagIcon } from 'lucide-react';
import api from '../api/client';
import { dateInputValueToISO, formatLocalDateForInput } from '../lib/dateLocal';
import { LocaleDateField } from './LocalePickers';
import { Button, Modal, CategoryIcon, cn } from './ui';
import { pickCategoryDisplayName } from '../lib/categoryDisplay';
import SplitAllocationsEditor, {
  type SplitAllocation,
  validateAllocations,
} from './SplitAllocationsEditor';

interface Category {
  id: string;
  name: string;
  name_zh?: string;
  name_en?: string;
  icon: string;
  color: string;
  type: string;
}

interface ProjectOption {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: string;
}

interface TagOption {
  id: string;
  name: string;
  color: string;
  exclude_from_stats: boolean;
}

interface Props {
  open: boolean;
  ledgerId: string;
  onClose: () => void;
  onSuccess: () => void;
  /** When creating a row, pre-select this project (e.g. project detail / FAB on project route). */
  defaultProjectId?: string;
  /**
   * Personal sub-ledgers linked under this family ledger. When non-empty, the
   * "split to sub-ledgers" toggle becomes available (create-mode only). Pass
   * `currentLedger.linked_personal` here on family ledger pages.
   */
  splitTargets?: { id: string; name: string }[];
  initial?: {
    id?: string;
    amount?: number;
    type?: string;
    category_id?: string;
    note?: string;
    date?: string;
    project_id?: string | null;
    tag_ids?: string[];
  };
}

export default function AddRecordModal({ open, ledgerId, onClose, onSuccess, initial, defaultProjectId, splitTargets }: Props) {
  const { t, i18n } = useTranslation('modals');
  const { t: tc } = useTranslation('common');
  const isEdit = !!initial?.id;
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? '');
  const [type, setType] = useState(initial?.type ?? 'expense');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initial?.category_id ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(() =>
    initial?.date ? formatLocalDateForInput(new Date(initial.date)) : formatLocalDateForInput(new Date()),
  );
  const [projectId, setProjectId] = useState<string>(initial?.project_id ?? '');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initial?.tag_ids ?? []);
  const [loading, setLoading] = useState(false);
  const [loadingCats, setLoadingCats] = useState(true);
  const [error, setError] = useState('');
  const [installmentEnabled, setInstallmentEnabled] = useState(false);
  const [installmentMonths, setInstallmentMonths] = useState('3');
  const [installmentMode, setInstallmentMode] = useState<'equal' | 'custom'>('equal');
  const [installmentCustom, setInstallmentCustom] = useState('');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitAllocations, setSplitAllocations] = useState<SplitAllocation[]>([]);
  const splitAvailable = !isEdit && (splitTargets?.length ?? 0) > 0 && (type === 'expense' || type === 'income');

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoadingCats(true);
      try {
        const res = await api.get(`/categories?ledger_id=${ledgerId}`);
        if (ignore) return;
        const all = (res.data || []) as Category[];
        const filtered = all.filter((c) => c.type === type);
        setCategories(filtered);
        if (!filtered.find((c) => c.id === selectedCategory) && filtered.length) {
          setSelectedCategory(filtered[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch categories', err);
      } finally {
        setLoadingCats(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [ledgerId, type]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await api.get(`/projects?ledger_id=${ledgerId}&status=active`);
        if (ignore) return;
        setProjects((res.data || []) as ProjectOption[]);
      } catch (err) {
        console.error('Failed to fetch projects', err);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [ledgerId]);

  // Fetch the tag catalog once per ledger. Kept separate from categories so
  // a new tag created mid-session doesn't require a full modal refresh.
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await api.get(`/tags?ledger_id=${ledgerId}`);
        if (ignore) return;
        setTags((res.data || []) as TagOption[]);
      } catch (err) {
        console.error('Failed to fetch tags', err);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [ledgerId]);

  // When the modal opens, sync form state from `initial` / `defaultProjectId` (parent may pass new objects each render).
  useEffect(() => {
    if (!open) return;
    const editing = !!initial?.id;
    if (editing) {
      setAmount(initial?.amount != null ? String(initial.amount) : '');
      setType((initial?.type as string) || 'expense');
      setSelectedCategory(initial?.category_id ?? '');
      setNote(initial?.note ?? '');
      setDate(
        initial?.date ? formatLocalDateForInput(new Date(initial.date)) : formatLocalDateForInput(new Date()),
      );
      setProjectId((initial?.project_id ?? '').toString());
      setSelectedTagIds(initial?.tag_ids ?? []);
      setInstallmentEnabled(false);
      setInstallmentMonths('3');
      setInstallmentMode('equal');
      setInstallmentCustom('');
      setSplitEnabled(false);
      setSplitAllocations([]);
    } else {
      setAmount('');
      setType('expense');
      setNote('');
      setDate(formatLocalDateForInput(new Date()));
      const pid = `${initial?.project_id ?? ''}`.trim() || `${defaultProjectId ?? ''}`.trim();
      setProjectId(pid);
      setSelectedCategory(initial?.category_id ?? '');
      setSelectedTagIds(initial?.tag_ids ?? []);
      setInstallmentEnabled(false);
      setInstallmentMonths('3');
      setInstallmentMode('equal');
      setInstallmentCustom('');
      setSplitEnabled(false);
      setSplitAllocations([]);
    }
    setError('');
  }, [
    open,
    initial?.id,
    initial?.amount,
    initial?.type,
    initial?.category_id,
    initial?.note,
    initial?.date,
    initial?.project_id,
    initial?.tag_ids,
    defaultProjectId,
  ]);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((x) => x !== tagId) : [...prev, tagId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !selectedCategory) return;
    setError('');
    setLoading(true);
    try {
      const total = parseFloat(amount);
      if (Number.isNaN(total) || total <= 0) {
        setError(t('saveFailed'));
        setLoading(false);
        return;
      }

      if (!isEdit && splitAvailable && splitEnabled) {
        const v = validateAllocations(splitAllocations, total);
        if (!v.ok) {
          setError(t(v.key));
          setLoading(false);
          return;
        }
        await api.post('/transactions/split', {
          source_ledger_id: ledgerId,
          type,
          category_id: selectedCategory,
          project_id: projectId || null,
          note,
          date: dateInputValueToISO(date),
          tag_ids: selectedTagIds,
          allocations: splitAllocations.map((a) => ({
            target_ledger_id: a.target_ledger_id,
            amount: parseFloat(a.amount),
          })),
        });
        onSuccess();
        onClose();
        return;
      }

      if (!isEdit && type === 'expense' && installmentEnabled) {
        const months = parseInt(installmentMonths, 10);
        if (Number.isNaN(months) || months < 2 || months > 60) {
          setError(t('installmentInvalidMonths'));
          setLoading(false);
          return;
        }
        let amounts: number[] | undefined;
        let mode = installmentMode;
        if (mode === 'custom') {
          const parts = installmentCustom
            .split(/[,，]/)
            .map((s) => parseFloat(s.trim()))
            .filter((n) => !Number.isNaN(n));
          if (parts.length !== months) {
            setError(t('installmentInvalidCustom'));
            setLoading(false);
            return;
          }
          const sum = parts.reduce((a, b) => a + b, 0);
          if (Math.abs(sum - total) > 0.02) {
            setError(t('installmentSumMismatch'));
            setLoading(false);
            return;
          }
          amounts = parts;
        }
        await api.post('/transactions/installment', {
          amount: total,
          category_id: selectedCategory,
          ledger_id: ledgerId,
          note,
          date: dateInputValueToISO(date),
          months,
          mode,
          amounts,
          tag_ids: selectedTagIds,
        });
        onSuccess();
        onClose();
        return;
      }

      const basePayload: Record<string, unknown> = {
        amount: total,
        type,
        category_id: selectedCategory,
        note,
        date: dateInputValueToISO(date),
        // Send tag_ids even when empty so edits can clear tags (backend
        // treats null = keep, [] = clear, [...] = replace).
        tag_ids: selectedTagIds,
      };
      if (isEdit && initial?.id) {
        if (projectId) {
          basePayload.project_id = projectId;
        } else {
          basePayload.clear_project = true;
        }
        await api.put(`/transactions/${initial.id}`, basePayload);
      } else {
        const createPayload = { ...basePayload, ledger_id: ledgerId } as Record<string, unknown>;
        if (projectId) createPayload.project_id = projectId;
        await api.post('/transactions', createPayload);
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || t('saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('addRecordEditTitle') : t('addRecordCreateTitle')}
      description={isEdit ? t('addRecordEditDesc') : t('addRecordCreateDesc')}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Type switcher */}
        <div className="flex bg-[var(--color-surface-muted)] p-1 rounded-[var(--radius-md)]">
          <button
            type="button"
            onClick={() => setType('expense')}
            className={cn(
              'flex-1 h-9 rounded-[var(--radius-sm)] text-sm font-medium flex items-center justify-center gap-1.5 transition-all',
              type === 'expense'
                ? 'bg-[var(--color-surface)] text-[var(--color-danger)] shadow-xs'
                : 'text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]',
            )}
          >
            <ArrowDown size={14} /> {t('expense')}
          </button>
          <button
            type="button"
            onClick={() => setType('income')}
            className={cn(
              'flex-1 h-9 rounded-[var(--radius-sm)] text-sm font-medium flex items-center justify-center gap-1.5 transition-all',
              type === 'income'
                ? 'bg-[var(--color-surface)] text-[var(--color-success)] shadow-xs'
                : 'text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]',
            )}
          >
            <ArrowUp size={14} /> {t('income')}
          </button>
        </div>

        {/* Amount */}
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)] text-xl font-semibold">¥</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full pl-10 pr-4 py-4 text-3xl font-semibold font-tabular text-[var(--color-text)] bg-[var(--color-surface-muted)] rounded-[var(--radius-lg)] border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20 transition-all"
            required
            autoFocus
          />
        </div>

        {!isEdit && type === 'expense' && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-3 space-y-2">
            <label className={cn(
              'flex items-center gap-2 text-xs font-medium select-none',
              splitEnabled ? 'text-[var(--color-text-subtle)] cursor-not-allowed' : 'text-[var(--color-text-muted)] cursor-pointer',
            )}>
              <input
                type="checkbox"
                disabled={splitEnabled}
                checked={installmentEnabled}
                onChange={(e) => setInstallmentEnabled(e.target.checked)}
                className="accent-[var(--color-brand)]"
              />
              {t('installmentSection')}
            </label>            {installmentEnabled && (
              <>
                <p className="text-[11px] text-[var(--color-text-subtle)] leading-relaxed">{t('installmentHint')}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-24">
                    <label className="text-[10px] text-[var(--color-text-muted)] block mb-1">{t('installmentMonths')}</label>
                    <input
                      type="number"
                      min={2}
                      max={60}
                      value={installmentMonths}
                      onChange={(e) => setInstallmentMonths(e.target.value)}
                      className="w-full h-9 px-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-tabular"
                    />
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setInstallmentMode('equal')}
                      className={cn(
                        'px-2.5 py-1.5 text-xs rounded-[var(--radius-md)] border',
                        installmentMode === 'equal'
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
                      )}
                    >
                      {t('installmentModeEqual')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setInstallmentMode('custom')}
                      className={cn(
                        'px-2.5 py-1.5 text-xs rounded-[var(--radius-md)] border',
                        installmentMode === 'custom'
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
                      )}
                    >
                      {t('installmentModeCustom')}
                    </button>
                  </div>
                </div>
                {installmentMode === 'custom' && (
                  <input
                    type="text"
                    value={installmentCustom}
                    onChange={(e) => setInstallmentCustom(e.target.value)}
                    placeholder={t('installmentCustomPlaceholder')}
                    className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-mono"
                  />
                )}
              </>
            )}
          </div>
        )}

        {splitAvailable && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-3 space-y-2">
            <label className={cn(
              'flex items-center gap-2 text-xs font-medium select-none',
              installmentEnabled ? 'text-[var(--color-text-subtle)] cursor-not-allowed' : 'text-[var(--color-text-muted)] cursor-pointer',
            )}>
              <input
                type="checkbox"
                disabled={installmentEnabled}
                checked={splitEnabled}
                onChange={(e) => setSplitEnabled(e.target.checked)}
                className="accent-[var(--color-brand)]"
              />
              {t('splitSection')}
            </label>
            {splitEnabled && (
              <>
                <p className="text-[11px] text-[var(--color-text-subtle)] leading-relaxed">{t('splitHint')}</p>
                <SplitAllocationsEditor
                  targets={splitTargets!}
                  totalAmount={parseFloat(amount) || 0}
                  allocations={splitAllocations}
                  onChange={setSplitAllocations}
                />
              </>
            )}
          </div>
        )}

        {/* Category grid */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('pickCategory')}</p>
          {loadingCats ? (
            <div className="h-24 flex items-center justify-center text-[var(--color-text-subtle)]">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-xs text-[var(--color-text-subtle)] py-6 text-center border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)]">
              {t('noCategories', {
                kind: type === 'expense' ? t('kindExpense') : t('kindIncome'),
              })}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {categories.map((cat) => {
                const active = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-2.5 rounded-[var(--radius-md)] border transition-all',
                      active
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]',
                    )}
                  >
                    <CategoryIcon name={cat.icon} color={cat.color} size={32} />
                    <span className="text-[11px] font-medium text-[var(--color-text)] truncate w-full text-center">
                      {pickCategoryDisplayName(i18n.language, cat.name_zh, cat.name_en) || cat.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Date + Note */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Calendar size={12} /> {t('date')}
            </label>
            <LocaleDateField
              value={date}
              onChange={setDate}
              className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm font-tabular outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">{t('note')}</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
            />
          </div>
        </div>

        {projects.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)] flex items-center gap-1.5">
              <FolderKanban size={12} /> {t('projectOptional')}
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
            >
              <option value="">{t('projectNone')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Always-visible tag section so users discover the feature even
            before creating any tags. Empty state links to the Categories
            page where TagsManager lives. */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)] flex items-center gap-1.5">
            <TagIcon size={12} /> {t('tagsOptional')}
          </label>
          {tags.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-subtle)] py-2 px-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)]">
              {t('tagsEmptyHint')}
              <a
                href="/categories"
                className="text-[var(--color-brand)] hover:underline"
                onClick={(e) => {
                  // Close the modal first so navigation doesn't feel abrupt.
                  e.preventDefault();
                  onClose();
                  window.location.href = '/categories';
                }}
              >
                {t('tagsEmptyMid')}
              </a>
              {t('tagsEmptyEnd')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tg) => {
                const active = selectedTagIds.includes(tg.id);
                return (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => toggleTag(tg.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors',
                      active
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-text)]'
                        : tg.exclude_from_stats
                        ? 'border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]',
                    )}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: tg.color || '#a78bfa' }}
                    />
                    {tg.name}
                    {tg.exclude_from_stats && (
                      <span className="text-[9px] opacity-70">{t('tagExcludedBadge')}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" fullWidth onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={loading} fullWidth disabled={!selectedCategory}>
            {isEdit
              ? t('saveChanges')
              : splitEnabled
                ? t('splitCreate')
                : type === 'expense' && installmentEnabled
                  ? t('installmentCreate')
                  : t('saveRecord')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
