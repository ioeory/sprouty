import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Tags, Lock, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import api from '../api/client';
import {
  Button,
  Card,
  CardHeader,
  CategoryIcon,
  EmptyState,
  Input,
  Modal,
  Badge,
  CATEGORY_COLORS,
  ICON_NAMES,
  cn,
} from '../components/ui';
import { useLayout } from '../components/AppLayout';
import CategoryKeywordsEditor from '../components/CategoryKeywordsEditor';
import type { CategoryKeyword } from '../components/CategoryKeywordsEditor';
import TagsManager from '../components/TagsManager';

interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: string;
  is_system: boolean;
  ledger_id: string;
  sort_order: number;
  keywords?: CategoryKeyword[];
}

interface EditState {
  id?: string;
  name: string;
  icon: string;
  color: string;
  type: 'expense' | 'income';
}

const DEFAULT_EDIT: EditState = {
  name: '',
  icon: 'Coins',
  color: CATEGORY_COLORS[0],
  type: 'expense',
};

export default function Categories() {
  const { currentLedger } = useLayout();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Category | null>(null);

  const load = async (ledgerId: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/categories?ledger_id=${ledgerId}`);
      setCategories(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentLedger) load(currentLedger.id);
  }, [currentLedger?.id]);

  const grouped = useMemo(() => {
    const expense = categories.filter((c) => c.type === 'expense');
    const income = categories.filter((c) => c.type === 'income');
    return { expense, income };
  }, [categories]);

  const openCreate = (type: 'expense' | 'income') => {
    setEditor({ ...DEFAULT_EDIT, type });
    setError('');
  };

  const openEdit = (cat: Category) => {
    setEditor({
      id: cat.id,
      name: cat.name,
      icon: cat.icon || 'Coins',
      color: cat.color || CATEGORY_COLORS[0],
      type: (cat.type as any) || 'expense',
    });
    setError('');
  };

  const save = async () => {
    if (!editor || !currentLedger) return;
    if (!editor.name.trim()) {
      setError('请填写分类名称');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editor.id) {
        await api.put(`/categories/${editor.id}`, {
          name: editor.name,
          icon: editor.icon,
          color: editor.color,
        });
      } else {
        await api.post('/categories', {
          name: editor.name,
          icon: editor.icon,
          color: editor.color,
          type: editor.type,
          ledger_id: currentLedger.id,
        });
      }
      setEditor(null);
      load(currentLedger.id);
    } catch (err: any) {
      setError(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || !currentLedger) return;
    setSaving(true);
    try {
      await api.delete(`/categories/${deleting.id}`);
      setDeleting(null);
      load(currentLedger.id);
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    } finally {
      setSaving(false);
    }
  };

  // Swap sort_order with the neighbor above/below within the same type bucket
  // so the user can nudge priority without thinking about absolute numbers.
  const moveSort = async (cat: Category, direction: 'up' | 'down') => {
    const bucket = categories
      .filter((c) => c.type === cat.type)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const idx = bucket.findIndex((c) => c.id === cat.id);
    if (idx === -1) return;
    const neighborIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= bucket.length) return;
    const neighbor = bucket[neighborIdx];
    const nextA = neighbor.sort_order;
    const nextB = cat.sort_order;
    // If they happen to have equal sort_order, force a gap of 10 so the swap sticks.
    const adjA = nextA === nextB ? nextA + (direction === 'up' ? 10 : -10) : nextA;
    try {
      await Promise.all([
        api.put(`/categories/${cat.id}`, { sort_order: adjA }),
        api.put(`/categories/${neighbor.id}`, { sort_order: nextB }),
      ]);
      if (currentLedger) load(currentLedger.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleKeywordsChange = (catId: string, nextKws: CategoryKeyword[]) => {
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, keywords: nextKws } : c)));
  };

  if (!currentLedger) {
    return (
      <Card>
        <EmptyState icon={<Tags size={18} />} title="请先选择账本" />
      </Card>
    );
  }

  const renderGroup = (label: string, type: 'expense' | 'income', items: Category[]) => (
    <Card padding="lg">
      <CardHeader
        icon={<Tags size={16} />}
        title={
          <span className="flex items-center gap-2">
            {label}
            <Badge tone={type === 'expense' ? 'danger' : 'success'}>
              {items.length}
            </Badge>
          </span>
        }
        action={
          <Button size="sm" variant="outline" leftIcon={<Plus size={12} />} onClick={() => openCreate(type)}>
            新建
          </Button>
        }
      />
      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState icon={<Tags size={18} />} title="暂无分类" />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((cat, idx) => (
              <li
                key={cat.id}
                className="group py-3 px-2 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <CategoryIcon name={cat.icon} color={cat.color} size={38} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] flex items-center gap-1.5 flex-wrap">
                      {cat.name}
                      {cat.is_system && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-subtle)]">
                          <Lock size={10} /> 系统
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-subtle)]">
                        优先级 {cat.sort_order}
                      </span>
                    </p>
                    <p className="text-[11px] text-[var(--color-text-subtle)] font-mono">
                      {cat.icon || 'Coins'} · {cat.color}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={() => moveSort(cat, 'up')}
                      title="提高优先级"
                      disabled={idx === 0}
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => moveSort(cat, 'down')}
                      title="降低优先级"
                      disabled={idx === items.length - 1}
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      onClick={() => openEdit(cat)}
                      title="编辑"
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
                    >
                      <Pencil size={13} />
                    </button>
                    {!cat.is_system && (
                      <button
                        onClick={() => setDeleting(cat)}
                        title="删除"
                        className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="pl-[50px]">
                  <CategoryKeywordsEditor
                    categoryId={cat.id}
                    keywords={cat.keywords || []}
                    onChange={(kws) => handleKeywordsChange(cat.id, kws)}
                    compact
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-widest">{currentLedger.name}</p>
        <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">分类管理</h1>
        <p className="text-xs text-[var(--color-text-subtle)] mt-1">
          为账本定制专属分类、图标与配色，记账时更容易识别
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-[var(--color-text-subtle)]">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderGroup('支出分类', 'expense', grouped.expense)}
          {renderGroup('收入分类', 'income', grouped.income)}
        </div>
      )}

      {/* Tags live alongside categories but are a separate concern: they
          annotate transactions across categories, and their main purpose is
          controlling what enters the statistics. */}
      <TagsManager ledgerId={currentLedger.id} />

      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.id ? '编辑分类' : '新建分类'}
        description={editor?.type === 'expense' ? '支出类分类' : '收入类分类'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditor(null)}>
              取消
            </Button>
            <Button loading={saving} onClick={save}>
              保存
            </Button>
          </>
        }
      >
        {editor && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <CategoryIcon name={editor.icon} color={editor.color} size={48} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)] truncate">
                  {editor.name || '未命名'}
                </p>
                <p className="text-xs text-[var(--color-text-subtle)]">预览</p>
              </div>
            </div>

            <Input
              label="名称"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="例如：外卖、房租、交通卡"
            />

            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">颜色</p>
              <div className="grid grid-cols-9 gap-1.5">
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditor({ ...editor, color: c })}
                    className={cn(
                      'w-7 h-7 rounded-full border transition-all',
                      editor.color === c
                        ? 'border-[var(--color-text)] scale-110 shadow-xs'
                        : 'border-transparent hover:scale-105',
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">图标</p>
              <div className="grid grid-cols-8 gap-1.5 max-h-44 overflow-y-auto p-1">
                {ICON_NAMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setEditor({ ...editor, icon: name })}
                    className={cn(
                      'p-0.5 rounded-[var(--radius-md)] transition-all',
                      editor.icon === name
                        ? 'bg-[var(--color-brand-soft)] ring-2 ring-[var(--color-brand)]'
                        : 'hover:bg-[var(--color-surface-muted)]',
                    )}
                    title={name}
                  >
                    <CategoryIcon name={name} color={editor.color} size={32} />
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
                {error}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        size="sm"
        title="删除分类？"
        description="该操作不可撤销"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="danger" loading={saving} onClick={confirmDelete}>
              删除
            </Button>
          </>
        }
      >
        {deleting && (
          <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
            <CategoryIcon name={deleting.icon} color={deleting.color} size={40} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-text)]">{deleting.name}</p>
              <p className="text-xs text-[var(--color-text-subtle)]">
                {deleting.type === 'expense' ? '支出分类' : '收入分类'}
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className="mt-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}
      </Modal>
    </div>
  );
}
