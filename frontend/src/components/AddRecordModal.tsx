import React, { useState, useEffect } from 'react';
import { Calendar, ArrowDown, ArrowUp, Loader2, FolderKanban, Tag as TagIcon } from 'lucide-react';
import api from '../api/client';
import { Button, Modal, CategoryIcon, cn } from './ui';

interface Category {
  id: string;
  name: string;
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

export default function AddRecordModal({ open, ledgerId, onClose, onSuccess, initial }: Props) {
  const isEdit = !!initial?.id;
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? '');
  const [type, setType] = useState(initial?.type ?? 'expense');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initial?.category_id ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(
    initial?.date ? new Date(initial.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
  );
  const [projectId, setProjectId] = useState<string>(initial?.project_id ?? '');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initial?.tag_ids ?? []);
  const [loading, setLoading] = useState(false);
  const [loadingCats, setLoadingCats] = useState(true);
  const [error, setError] = useState('');

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

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !selectedCategory) return;
    setError('');
    setLoading(true);
    try {
      const basePayload: Record<string, unknown> = {
        amount: parseFloat(amount),
        type,
        category_id: selectedCategory,
        note,
        date: new Date(date).toISOString(),
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
      setError(err.response?.data?.error || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '编辑记录' : '记一笔'}
      description={isEdit ? '修改这笔交易的信息' : '快速录入一笔收支'}
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
            <ArrowDown size={14} /> 支出
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
            <ArrowUp size={14} /> 收入
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

        {/* Category grid */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">选择分类</p>
          {loadingCats ? (
            <div className="h-24 flex items-center justify-center text-[var(--color-text-subtle)]">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-xs text-[var(--color-text-subtle)] py-6 text-center border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)]">
              还没有{type === 'expense' ? '支出' : '收入'}分类，请先到"分类管理"里创建
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
                      {cat.name}
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
              <Calendar size={12} /> 日期
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm font-tabular outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">备注</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="花在了什么上…"
              className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
            />
          </div>
        </div>

        {projects.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-muted)] flex items-center gap-1.5">
              <FolderKanban size={12} /> 所属项目（可选）
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
            >
              <option value="">不归属任何项目</option>
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
            <TagIcon size={12} /> 标签（可选）
          </label>
          {tags.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-subtle)] py-2 px-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)]">
              还没有标签。到「
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
                分类 → 标签
              </a>
              」卡片创建标签后，这里就能勾选，支出分析也能据此排除。
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
                      <span className="text-[9px] opacity-70">排除</span>
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
            取消
          </Button>
          <Button type="submit" loading={loading} fullWidth disabled={!selectedCategory}>
            {isEdit ? '保存修改' : '保存记录'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
