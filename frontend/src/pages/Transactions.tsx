import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['transactions', 'common']);
  const { currentLedger, ledgers } = useLayout();
  const mutableLedgerIds = useMutableLedgerIdSet(ledgers);

  const fmtDateHeader = useCallback(
    (key: string) => {
      const [y, m, d] = key.split('-').map(Number);
      const today = new Date();
      const date = new Date(y, m - 1, d);
      const diff = Math.floor((today.getTime() - date.getTime()) / 86400000);
      if (diff === 0) return t('transactions:dateHeaderToday', { m, d });
      if (diff === 1) return t('transactions:dateHeaderYesterday', { m, d });
      const weekdays = t('transactions:weekdays', { returnObjects: true }) as string[];
      return t('transactions:dateHeader', { m, d, weekday: weekdays[date.getDay()] });
    },
    [t],
  );
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
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
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
      setTxFeedback(t('transactions:deleteForbiddenMerged'));
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
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('transactions:deleteFailed');
      setTxFeedback(msg);
    } finally {
      setConfirmLoading(false);
    }
  };

  if (!currentLedger) {
    return (
      <Card>
        <EmptyState icon={<Receipt size={18} />} title={t('transactions:selectLedgerFirst')} />
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
            aria-label={t('transactions:closeHint')}
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
              <span className="normal-case text-[var(--color-text-muted)]">{t('transactions:mergedFlowHint')}</span>
            )}
          </p>
          <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">{t('transactions:title')}</h1>
          {showMergedFamilyHint && (
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 max-w-xl leading-relaxed">
              {t('transactions:mergedReadonlyHint')}
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
            {t('transactions:filter')}{' '}
            {activeFilterCount > 0 && <span className="ml-1 text-[var(--color-brand)]">·{activeFilterCount}</span>}
            {filterOpen ? <ChevronUp size={12} className="ml-1" /> : <ChevronDown size={12} className="ml-1" />}
          </Button>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setAdding(true)}>
            {t('transactions:add')}
          </Button>
        </div>
      </div>

      {/* Totals */}
      <Card padding="sm">
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border)]">
          <div className="pr-3">
            <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">
              {t('transactions:totalCount', { total })}
            </p>
            <p className="text-sm font-medium text-[var(--color-text)] mt-0.5">
              {t('transactions:loadedCount', { count: txs.length })}
            </p>
          </div>
          <div className="px-3">
            <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('transactions:viewExpense')}</p>
            <p className="text-sm font-semibold font-tabular text-[var(--color-text)] mt-0.5">
              ¥{monthTotal.expense.toLocaleString()}
            </p>
          </div>
          <div className="pl-3">
            <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('transactions:viewIncome')}</p>
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
              placeholder={t('transactions:searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="md:col-span-2"
            />
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">{t('transactions:typeAll')}</option>
              <option value="expense">{t('transactions:typeExpense')}</option>
              <option value="income">{t('transactions:typeIncome')}</option>
            </Select>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">{t('transactions:categoryAll')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.type === 'expense' ? t('transactions:categoryTypeExpense') : t('transactions:categoryTypeIncome')}）
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
                {t('transactions:clearFilters')}
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
            title={t('transactions:emptyTitle')}
            description={
              activeFilterCount > 0 ? t('transactions:emptyDescFiltered') : t('transactions:emptyDescDefault')
            }
            action={
              activeFilterCount > 0 ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  {t('transactions:clearFilters')}
                </Button>
              ) : (
                <Button size="sm" leftIcon={<Plus size={12} />} onClick={() => setAdding(true)}>
                  {t('transactions:addFirst')}
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
                      {dayExpense > 0 && (
                        <span>{t('transactions:dayExpense', { amount: dayExpense.toLocaleString() })}</span>
                      )}
                      {dayExpense > 0 && dayIncome > 0 && <span className="mx-1">·</span>}
                      {dayIncome > 0 && (
                        <span className="text-[var(--color-success)]">
                          {t('transactions:dayIncome', { amount: dayIncome.toLocaleString() })}
                        </span>
                      )}
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
                              {cat?.name || t('transactions:uncategorized')}
                              {subName && (
                                <span className="text-[10px] text-[var(--color-brand)] shrink-0">· {subName}</span>
                              )}
                              {!canMutate && (
                                <Badge tone="warning" className="!text-[10px] !py-0 !px-1.5 font-normal shrink-0">
                                  {t('transactions:badgeReadonly')}
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
                                    title={tg.exclude_from_stats ? t('transactions:tagExcludeTitle') : ''}
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
                            className={`flex shrink-0 items-center gap-1 transition-opacity ${
                              // Touch / no-hover: always show actions. Fine pointer + hover: hide until row hover.
                              canMutate
                                ? 'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100'
                                : 'opacity-100'
                            }`}
                          >
                            <button
                              type="button"
                              disabled={!canMutate}
                              onClick={() => {
                                if (!canMutate) {
                                  setTxFeedback(t('transactions:editForbidden'));
                                  return;
                                }
                                setTxFeedback('');
                                setEditing(tx);
                              }}
                              title={
                                canMutate ? t('transactions:edit') : t('transactions:editForbiddenTitle')
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
                                  setTxFeedback(t('transactions:deleteForbiddenMerged'));
                                  return;
                                }
                                setTxFeedback('');
                                setDeleting(tx);
                              }}
                              title={canMutate ? t('common:delete') : t('transactions:deleteForbiddenTitle')}
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
                  {t('transactions:loadMore', { remaining: total - txs.length })}
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
        title={t('transactions:confirmDeleteTitle')}
        description={t('transactions:confirmDeleteDesc')}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('common:cancel')}
            </Button>
            <Button variant="danger" loading={confirmLoading} onClick={confirmDelete}>
              {t('common:delete')}
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
              <p className="text-sm text-[var(--color-text)]">
                {categoryMap[deleting.category_id]?.name || t('transactions:uncategorized')}
              </p>
              <p className="text-xs text-[var(--color-text-subtle)] truncate">
                {deleting.note || t('transactions:noNote')}
              </p>
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
