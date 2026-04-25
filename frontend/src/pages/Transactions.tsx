import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Filter,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Receipt,
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import api from '../api/client';
import { Badge, Button, Card, CategoryIcon, EmptyState, Input, Select, Modal } from '../components/ui';
import AddRecordModal from '../components/AddRecordModal';
import { useLayout } from '../components/AppLayout';

interface TxTag {
  id: string;
  name: string;
  color: string;
  exclude_from_stats: boolean;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  category_id: string;
  note: string;
  tags: string;
  tag_refs?: TxTag[]; // structured tag list populated by the backend
  project_id?: string | null;
  date: string;
  ledger_id?: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: string;
}

function groupByDate(txs: Transaction[]): Array<[string, Transaction[]]> {
  const map = new Map<string, Transaction[]>();
  txs.forEach((tx) => {
    const d = new Date(tx.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const bucket = map.get(key) || [];
    bucket.push(tx);
    map.set(key, bucket);
  });
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

function fmtDateHeader(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const today = new Date();
  const date = new Date(y, m - 1, d);
  const diff = Math.floor((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return `今天 · ${m}月${d}日`;
  if (diff === 1) return `昨天 · ${m}月${d}日`;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${m}月${d}日 · ${weekdays[date.getDay()]}`;
}

const PAGE_SIZE = 50;

/** 当前用户作为成员可写操作的账本 ID（家庭合并视图下，他人子账流水不在此集合中） */
function useMutableLedgerIdSet(ledgers: { id: string }[]) {
  return useMemo(() => new Set(ledgers.map((l) => l.id)), [ledgers]);
}

function canMutateTransaction(tx: Transaction, currentLedgerId: string, mutableIds: Set<string>): boolean {
  const lid = tx.ledger_id || currentLedgerId;
  return mutableIds.has(lid);
}

function mergeCategoriesById(lists: Category[][]): Category[] {
  const out: Category[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const c of list) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  return out;
}

export default function Transactions() {
  const { currentLedger, ledgers } = useLayout();
  const mutableLedgerIds = useMutableLedgerIdSet(ledgers);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);

  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [txFeedback, setTxFeedback] = useState('');

  const categoryMap = useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => (map[c.id] = c));
    return map;
  }, [categories]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadCategories = async () => {
    if (!currentLedger) return;
    try {
      const cluster =
        currentLedger.type === 'family'
          ? [currentLedger.id, ...(currentLedger.linked_personal || []).map((p) => p.id)]
          : [currentLedger.id];
      const results = await Promise.all(cluster.map((id) => api.get(`/categories?ledger_id=${id}`)));
      setCategories(mergeCategoriesById(results.map((r) => r.data || [])));
    } catch (err) {
      console.error('Failed to load categories', err);
    }
  };

  const load = async (reset = true) => {
    if (!currentLedger) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ledger_id: currentLedger.id,
        limit: String(PAGE_SIZE),
        offset: String(reset ? 0 : offset),
      });
      if (typeFilter) params.set('type', typeFilter);
      if (categoryFilter) params.set('category_id', categoryFilter);
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      if (debouncedSearch) params.set('q', debouncedSearch);

      const res = await api.get(`/transactions?${params.toString()}`);
      const items: Transaction[] = res.data?.items || [];
      const t: number = res.data?.total ?? items.length;
      if (reset) {
        setTxs(items);
        setOffset(items.length);
      } else {
        setTxs((prev) => [...prev, ...items]);
        setOffset((prev) => prev + items.length);
      }
      setTotal(t);
    } catch (err) {
      console.error('Failed to load transactions', err);
    } finally {
      setLoading(false);
    }
  };

  const linkedKey = [
    currentLedger?.linked_personal?.map((p) => p.id).join(',') ?? '',
    currentLedger?.linked_personal_count ?? 0,
  ].join('|');

  useEffect(() => {
    if (currentLedger) {
      void loadCategories();
    }
  }, [currentLedger?.id, currentLedger?.type, linkedKey]);

  useEffect(() => {
    if (currentLedger) {
      load(true);
    }
  }, [currentLedger?.id, typeFilter, categoryFilter, startDate, endDate, debouncedSearch]);

  const groups = useMemo(() => groupByDate(txs), [txs]);

  const monthTotal = useMemo(() => {
    return txs.reduce(
      (acc, t) => {
        if (t.type === 'income') acc.income += t.amount;
        else acc.expense += t.amount;
        return acc;
      },
      { income: 0, expense: 0 },
    );
  }, [txs]);

  const hasMore = txs.length < total;
  const activeFilterCount =
    [typeFilter, categoryFilter, startDate, endDate, debouncedSearch].filter(Boolean).length;

  const clearFilters = () => {
    setTypeFilter('');
    setCategoryFilter('');
    setStartDate('');
    setEndDate('');
    setSearch('');
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    if (!canMutateTransaction(deleting, currentLedger.id, mutableLedgerIds)) {
      setTxFeedback('无法删除：该笔流水记在关联成员的子账上，您不是该子账成员。');
      setDeleting(null);
      return;
    }
    setConfirmLoading(true);
    setTxFeedback('');
    try {
      await api.delete(`/transactions/${deleting.id}`);
      setDeleting(null);
      load(true);
    } catch (err: unknown) {
      console.error(err);
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '删除失败，请稍后重试';
      setTxFeedback(msg);
    } finally {
      setConfirmLoading(false);
    }
  };

  if (!currentLedger) {
    return (
      <Card>
        <EmptyState icon={<Receipt size={18} />} title="请先选择账本" />
      </Card>
    );
  }

  const showMergedFamilyHint =
    currentLedger.type === 'family' &&
    ((currentLedger.linked_personal_count ?? 0) > 0 || (currentLedger.linked_personal?.length ?? 0) > 0);

  return (
    <div className="space-y-5">
      {txFeedback && (
        <div
          className="p-3 rounded-[var(--radius-md)] text-xs border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text)] flex justify-between gap-3 items-start"
          role="status"
        >
          <span>{txFeedback}</span>
          <button
            type="button"
            onClick={() => setTxFeedback('')}
            className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-widest">
            {currentLedger.name}
            {showMergedFamilyHint && (
              <span className="normal-case text-[var(--color-text-muted)]"> · 含本家庭已关联子账流水</span>
            )}
          </p>
          <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">流水记录</h1>
          {showMergedFamilyHint && (
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 max-w-xl leading-relaxed">
              若某笔来自其他成员关联的个人子账，且您不是该子账成员，则仅可查看；编辑、删除按钮不可用。删除接口也会校验权限。
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Filter size={14} />}
            onClick={() => setFilterOpen((v) => !v)}
          >
            筛选 {activeFilterCount > 0 && <span className="ml-1 text-[var(--color-brand)]">·{activeFilterCount}</span>}
            {filterOpen ? <ChevronUp size={12} className="ml-1" /> : <ChevronDown size={12} className="ml-1" />}
          </Button>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setAdding(true)}>
            新增
          </Button>
        </div>
      </div>

      {/* Totals */}
      <Card padding="sm">
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border)]">
          <div className="pr-3">
            <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">共 {total} 条</p>
            <p className="text-sm font-medium text-[var(--color-text)] mt-0.5">已加载 {txs.length}</p>
          </div>
          <div className="px-3">
            <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">本视图支出</p>
            <p className="text-sm font-semibold font-tabular text-[var(--color-text)] mt-0.5">
              ¥{monthTotal.expense.toLocaleString()}
            </p>
          </div>
          <div className="pl-3">
            <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">本视图收入</p>
            <p className="text-sm font-semibold font-tabular text-[var(--color-success)] mt-0.5">
              ¥{monthTotal.income.toLocaleString()}
            </p>
          </div>
        </div>
      </Card>

      {/* Filter panel */}
      {filterOpen && (
        <Card padding="md" className="animate-slide-up">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Input
              leftIcon={<Search size={14} />}
              placeholder="搜索备注或标签"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="md:col-span-2"
            />
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">全部类型</option>
              <option value="expense">仅支出</option>
              <option value="income">仅收入</option>
            </Select>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.type === 'expense' ? '支' : '收'}）
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-10 px-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-tabular text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-10 px-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-tabular text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
              />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" leftIcon={<X size={12} />} onClick={clearFilters}>
                清空筛选
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* List */}
      <Card padding="none">
        {loading && txs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[var(--color-text-subtle)]">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Receipt size={18} />}
            title="没有符合条件的记录"
            description={activeFilterCount > 0 ? '试试调整或清空筛选条件' : '从右上角「新增」开始记录第一笔'}
            action={
              activeFilterCount > 0 ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  清空筛选
                </Button>
              ) : (
                <Button size="sm" leftIcon={<Plus size={12} />} onClick={() => setAdding(true)}>
                  记一笔
                </Button>
              )
            }
          />
        ) : (
          <div>
            {groups.map(([dateKey, list]) => {
              const dayExpense = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
              const dayIncome = list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
              return (
                <div key={dateKey} className="border-b border-[var(--color-border)] last:border-b-0">
                  <div className="flex items-center justify-between px-5 py-2.5 bg-[var(--color-surface-muted)]/60 sticky top-14 z-10">
                    <span className="text-xs font-medium text-[var(--color-text-muted)]">{fmtDateHeader(dateKey)}</span>
                    <span className="text-[11px] text-[var(--color-text-subtle)] font-tabular">
                      {dayExpense > 0 && <span>支 ¥{dayExpense.toLocaleString()}</span>}
                      {dayExpense > 0 && dayIncome > 0 && <span className="mx-1">·</span>}
                      {dayIncome > 0 && <span className="text-[var(--color-success)]">收 ¥{dayIncome.toLocaleString()}</span>}
                    </span>
                  </div>
                  <ul className="divide-y divide-[var(--color-border)]">
                    {list.map((tx) => {
                      const cat = categoryMap[tx.category_id];
                      const subName =
                        tx.ledger_id && tx.ledger_id !== currentLedger.id
                          ? ledgers.find((l) => l.id === tx.ledger_id)?.name
                          : null;
                      const canMutate = canMutateTransaction(tx, currentLedger.id, mutableLedgerIds);
                      return (
                        <li
                          key={tx.id}
                          className="group flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
                        >
                          <CategoryIcon name={cat?.icon} color={cat?.color} size={36} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[var(--color-text)] truncate flex items-center gap-1.5 flex-wrap">
                              {cat?.name || '未分类'}
                              {subName && (
                                <span className="text-[10px] text-[var(--color-brand)] shrink-0">· {subName}</span>
                              )}
                              {!canMutate && (
                                <Badge tone="warning" className="!text-[10px] !py-0 !px-1.5 font-normal shrink-0">
                                  无权限修改
                                </Badge>
                              )}
                              {tx.type === 'income' ? (
                                <ArrowUp size={12} className="text-[var(--color-success)]" />
                              ) : (
                                <ArrowDown size={12} className="text-[var(--color-text-subtle)]" />
                              )}
                            </p>
                            {tx.note && <p className="text-xs text-[var(--color-text-subtle)] truncate mt-0.5">{tx.note}</p>}
                            {tx.tag_refs && tx.tag_refs.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {tx.tag_refs.map((tg) => (
                                  <span
                                    key={tg.id}
                                    className={
                                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ' +
                                      (tg.exclude_from_stats
                                        ? 'bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)] border border-dashed border-[var(--color-border)]'
                                        : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]')
                                    }
                                    title={tg.exclude_from_stats ? '该标签默认从统计中排除' : ''}
                                  >
                                    <span
                                      className="w-1.5 h-1.5 rounded-full"
                                      style={{ backgroundColor: tg.color || '#a78bfa' }}
                                    />
                                    {tg.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <span
                            className={`text-sm font-semibold font-tabular ${
                              tx.type === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--color-text)]'
                            }`}
                          >
                            {tx.type === 'income' ? '+' : '-'}¥{tx.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                          <div
                            className={`flex items-center gap-1 transition-opacity ${
                              canMutate ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                            }`}
                          >
                            <button
                              type="button"
                              disabled={!canMutate}
                              onClick={() => {
                                if (!canMutate) {
                                  setTxFeedback(
                                    '无权限修改：该笔流水记在关联成员的子账上，您不是该子账成员，无法在合并视图中编辑。',
                                  );
                                  return;
                                }
                                setTxFeedback('');
                                setEditing(tx);
                              }}
                              title={
                                canMutate
                                  ? '编辑'
                                  : '无权限修改：该笔流水属于其他成员关联的子账，您仅可在此查看'
                              }
                              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-subtle)]"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              disabled={!canMutate}
                              onClick={() => {
                                if (!canMutate) {
                                  setTxFeedback(
                                    '无法删除：该笔流水记在关联成员的子账上，您不是该子账成员，无权删除。',
                                  );
                                  return;
                                }
                                setTxFeedback('');
                                setDeleting(tx);
                              }}
                              title={
                                canMutate
                                  ? '删除'
                                  : '无法删除：该笔流水属于其他成员关联的子账，仅该子账成员可删除'
                              }
                              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-subtle)]"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {hasMore && (
              <div className="p-4 border-t border-[var(--color-border)] text-center">
                <Button variant="ghost" size="sm" loading={loading} onClick={() => load(false)}>
                  加载更多 ({total - txs.length} 条剩余)
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {adding && currentLedger && (
        <AddRecordModal
          open
          ledgerId={currentLedger.id}
          onClose={() => setAdding(false)}
          onSuccess={() => {
            setAdding(false);
            load(true);
          }}
        />
      )}

      {editing && currentLedger && (
        <AddRecordModal
          open
          ledgerId={editing.ledger_id || currentLedger.id}
          initial={{
            ...editing,
            tag_ids: editing.tag_refs?.map((t) => t.id) ?? [],
          }}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            load(true);
          }}
        />
      )}

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        size="sm"
        title="确认删除？"
        description="删除后无法恢复"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="danger" loading={confirmLoading} onClick={confirmDelete}>
              删除
            </Button>
          </>
        }
      >
        {deleting && (
          <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
            <CategoryIcon
              name={categoryMap[deleting.category_id]?.icon}
              color={categoryMap[deleting.category_id]?.color}
              size={36}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--color-text)]">{categoryMap[deleting.category_id]?.name || '未分类'}</p>
              <p className="text-xs text-[var(--color-text-subtle)] truncate">{deleting.note || '无备注'}</p>
            </div>
            <span
              className={`text-sm font-semibold font-tabular ${
                deleting.type === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--color-text)]'
              }`}
            >
              {deleting.type === 'income' ? '+' : '-'}¥{deleting.amount.toFixed(2)}
            </span>
          </div>
        )}
      </Modal>
    </div>
  );
}
