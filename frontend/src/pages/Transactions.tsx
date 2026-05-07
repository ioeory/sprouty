import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Layers,
  Split,
} from 'lucide-react';
import api from '../api/client';
import { Badge, Button, Card, CategoryIcon, EmptyState, Input, Select, Modal } from '../components/ui';
import AddRecordModal from '../components/AddRecordModal';
import SplitGroupDrawer from '../components/SplitGroupDrawer';
import ConvertToSplitModal from '../components/ConvertToSplitModal';
import { LocaleDateField, LocaleMonthField } from '../components/LocalePickers';
import { useLayout } from '../components/AppLayout';
import { pickCategoryDisplayName } from '../lib/categoryDisplay';
import { groupCategoriesBySemanticKey } from '../lib/categoryMerge';

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
  created_at?: string;
  ledger_id?: string;
  installment_group_id?: string;
  split_group_id?: string;
}

interface Category {
  id: string;
  name: string;
  name_zh?: string;
  name_en?: string;
  icon: string;
  color: string;
  type: string;
}

interface SplitGroupRow {
  id: string;
  source_ledger_id: string;
  total_amount: number;
  type: string;
  date: string;
  note: string;
  child_count: number;
  children: Array<{ id: string; ledger_id: string; amount: number }>;
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
  const byCreatedDesc = (a: Transaction, b: Transaction) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return b.id.localeCompare(a.id);
  };
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => [key, [...list].sort(byCreatedDesc)] as [string, Transaction[]]);
}

const TX_PAGE_SIZE_STORAGE_KEY = 'sprouts_transactions_page_size';
const PAGE_SIZE_PRESETS = [20, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

function readStoredPageSize(): number {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  try {
    const raw = localStorage.getItem(TX_PAGE_SIZE_STORAGE_KEY);
    const n = parseInt(raw || '', 10);
    if (PAGE_SIZE_PRESETS.includes(n as (typeof PAGE_SIZE_PRESETS)[number])) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_PAGE_SIZE;
}

/** 当前用户作为成员可写操作的账本 ID（家庭合并视图下，他人子账流水不在此集合中） */
function useMutableLedgerIdSet(ledgers: { id: string }[]) {
  return useMemo(() => new Set(ledgers.map((l) => l.id)), [ledgers]);
}

function canMutateTransaction(tx: Transaction, currentLedgerId: string, mutableIds: Set<string>, currentLedgerType?: string): boolean {
  const lid = tx.ledger_id || currentLedgerId;
  return mutableIds.has(lid) || (!!tx.split_group_id && currentLedgerType === 'family' && mutableIds.has(currentLedgerId));
}

/** Local calendar bounds as `YYYY-MM-DD` for API date filters. */
function boundsForYearMonth(ym: string): { start: string; end: string } | null {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  const lastDay = new Date(y, mo, 0).getDate();
  return {
    start: `${y}-${String(mo).padStart(2, '0')}-01`,
    end: `${y}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

export default function Transactions() {
  const { t, i18n } = useTranslation(['transactions', 'common']);
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
  const [allCategoriesFlat, setAllCategoriesFlat] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  // ledgerFilter: subset of family-cluster ledger ids the user wants to see.
  // Empty = no client-side restriction (show the full cluster).
  const [ledgerFilter, setLedgerFilter] = useState<string[]>([]);

  const [typeFilter, setTypeFilter] = useState('');
  /** Semantic merge key from `groupCategoriesBySemanticKey`; empty = all categories */
  const [categoryMergeKey, setCategoryMergeKey] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [billMonth, setBillMonth] = useState('');
  const [sumExpense, setSumExpense] = useState<number | null>(null);
  const [sumIncome, setSumIncome] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [txFeedback, setTxFeedback] = useState('');
  const [pageSize, setPageSize] = useState(readStoredPageSize);

  const [convertSplitTx, setConvertSplitTx] = useState<Transaction | null>(null);
  const [openSplitGroupId, setOpenSplitGroupId] = useState<string | null>(null);
  const [showSplitGroups, setShowSplitGroups] = useState(false);
  const [splitGroups, setSplitGroups] = useState<SplitGroupRow[]>([]);
  const [loadingSplitGroups, setLoadingSplitGroups] = useState(false);

  const ledgerNameById = useMemo(() => {
    const map: Record<string, string> = {};
    ledgers.forEach((l) => {
      map[l.id] = l.name;
    });
    return map;
  }, [ledgers]);

  const familySplitTargets = useMemo(() => {
    if (!currentLedger || currentLedger.type !== 'family') return [];
    return currentLedger.linked_personal ?? [];
  }, [currentLedger]);

  const categoryEntityById = useMemo(() => {
    const map: Record<string, Category> = {};
    allCategoriesFlat.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [allCategoriesFlat]);

  const categoryGroups = useMemo(
    () => groupCategoriesBySemanticKey(allCategoriesFlat),
    [allCategoriesFlat],
  );

  const mergedCategorySelectOptions = useMemo(() => {
    const rows = Array.from(categoryGroups.entries()).map(([key, { rep }]) => {
      const lab =
        pickCategoryDisplayName(i18n.language, rep.name_zh, rep.name_en) || rep.name;
      const suf =
        rep.type === 'expense' ? t('transactions:categoryTypeExpense') : t('transactions:categoryTypeIncome');
      return { key, label: `${lab}（${suf}）` };
    });
    rows.sort((a, b) => a.label.localeCompare(b.label, i18n.language));
    return rows;
  }, [categoryGroups, i18n.language, t]);

  const categoryLabel = (c: Category | undefined) =>
    (c && (pickCategoryDisplayName(i18n.language, c.name_zh, c.name_en) || c.name)) || '';

  const canMutateInCurrentContext = useCallback(
    (tx: Transaction) =>
      !!currentLedger && canMutateTransaction(tx, currentLedger.id, mutableLedgerIds, currentLedger.type),
    [currentLedger, mutableLedgerIds],
  );

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
      const flat = results.flatMap((r) => (r.data || []) as Category[]);
      setAllCategoriesFlat(flat);
    } catch (err) {
      console.error('Failed to load categories', err);
    }
  };

  const load = async (reset = true, limitOverride?: number) => {
    if (!currentLedger) return;
    const limit = limitOverride ?? pageSize;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ledger_id: currentLedger.id,
        limit: String(limit),
        offset: String(reset ? 0 : offset),
      });
      if (typeFilter) params.set('type', typeFilter);
      if (categoryMergeKey) {
        const g = categoryGroups.get(categoryMergeKey);
        if (g?.ids?.length) params.set('category_ids', g.ids.join(','));
      }
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (ledgerFilter.length > 0) params.set('ledger_ids', ledgerFilter.join(','));

      const res = await api.get(`/transactions?${params.toString()}`);
      const items: Transaction[] = res.data?.items || [];
      const t: number = res.data?.total ?? items.length;
      const se = res.data?.sum_expense;
      const si = res.data?.sum_income;
      setSumExpense(typeof se === 'number' ? se : null);
      setSumIncome(typeof si === 'number' ? si : null);
      if (reset) {
        setTxs(items);
        setOffset(items.length);
        setSelectedIds(new Set());
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

  const loadSplitGroups = useCallback(async () => {
    if (!currentLedger) return;
    setLoadingSplitGroups(true);
    try {
      const res = await api.get(`/split-groups?ledger_id=${currentLedger.id}`);
      setSplitGroups((res.data || []) as SplitGroupRow[]);
    } catch (err) {
      console.error('Failed to load split groups', err);
    } finally {
      setLoadingSplitGroups(false);
    }
  }, [currentLedger]);

  useEffect(() => {
    if (showSplitGroups) {
      void loadSplitGroups();
    }
  }, [showSplitGroups, loadSplitGroups, linkedKey]);

  useEffect(() => {
    if (currentLedger) {
      void loadCategories();
    }
  }, [currentLedger?.id, currentLedger?.type, linkedKey]);

  useEffect(() => {
    setCategoryMergeKey('');
  }, [currentLedger?.id]);

  useEffect(() => {
    if (currentLedger) {
      load(true);
    }
  }, [currentLedger?.id, typeFilter, categoryMergeKey, categoryGroups, startDate, endDate, debouncedSearch, ledgerFilter]);

  useEffect(() => {
    if (!startDate || !endDate) {
      setBillMonth('');
    }
  }, [startDate, endDate]);

  const groups = useMemo(() => groupByDate(txs), [txs]);

  const selectedTransactions = useMemo(
    () => txs.filter((tx) => selectedIds.has(tx.id)),
    [txs, selectedIds],
  );

  const selectedMutableTransactions = useMemo(
    () => selectedTransactions.filter(canMutateInCurrentContext),
    [selectedTransactions, canMutateInCurrentContext],
  );

  const selectedExpenseTotal = selectedMutableTransactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const selectedIncomeTotal = selectedMutableTransactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const loadedTotals = useMemo(() => {
    return txs.reduce(
      (acc, t) => {
        if (t.type === 'income') acc.income += t.amount;
        else acc.expense += t.amount;
        return acc;
      },
      { income: 0, expense: 0 },
    );
  }, [txs]);

  const displayExpense = sumExpense ?? loadedTotals.expense;
  const displayIncome = sumIncome ?? loadedTotals.income;

  // Reset the per-ledger filter when switching ledgers; the chips only make
  // sense in the context of the current family cluster.
  useEffect(() => {
    setLedgerFilter([]);
  }, [currentLedger?.id]);

  const hasMore = txs.length < total;
  const activeFilterCount =
    [typeFilter, categoryMergeKey, startDate, endDate, debouncedSearch].filter(Boolean).length +
    (ledgerFilter.length > 0 ? 1 : 0);

  const clearFilters = () => {
    setTypeFilter('');
    setCategoryMergeKey('');
    setStartDate('');
    setEndDate('');
    setBillMonth('');
    setSearch('');
    setLedgerFilter([]);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisibleMutable = () => {
    setSelectedIds(new Set(txs.filter(canMutateInCurrentContext).map((tx) => tx.id)));
  };

  const maxBillMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const confirmDelete = async () => {
    if (!deleting) return;
    if (!currentLedger || !canMutateInCurrentContext(deleting)) {
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
      setDeleting(null);
    } finally {
      setConfirmLoading(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (selectedMutableTransactions.length === 0) {
      setTxFeedback(t('transactions:bulkDeleteNoSelection'));
      setBulkDeleteOpen(false);
      return;
    }
    setBulkDeleting(true);
    setTxFeedback('');
    try {
      await api.post('/transactions/bulk-delete', { ids: selectedMutableTransactions.map((tx) => tx.id) });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      load(true);
      if (showSplitGroups) void loadSplitGroups();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        t('transactions:bulkDeleteFailed');
      setTxFeedback(msg);
    } finally {
      setBulkDeleting(false);
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
          {currentLedger?.type === 'family' && familySplitTargets.length > 0 && (
            <Button
              variant={showSplitGroups ? 'primary' : 'outline'}
              size="sm"
              leftIcon={<Split size={14} />}
              onClick={() => setShowSplitGroups((v) => !v)}
            >
              {t('transactions:splitGroupsToggle')}
            </Button>
          )}
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="grid grid-cols-3 flex-1 min-w-0 divide-x divide-[var(--color-border)]">
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
                ¥{displayExpense.toLocaleString()}
              </p>
            </div>
            <div className="pl-3">
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('transactions:viewIncome')}</p>
              <p className="text-sm font-semibold font-tabular text-[var(--color-success)] mt-0.5">
                ¥{displayIncome.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="shrink-0 w-full sm:w-36">
            <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">
              {t('transactions:pageSizeLabel')}
            </p>
            <Select
              value={String(pageSize)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!PAGE_SIZE_PRESETS.includes(n as (typeof PAGE_SIZE_PRESETS)[number])) return;
                setPageSize(n);
                try {
                  localStorage.setItem(TX_PAGE_SIZE_STORAGE_KEY, String(n));
                } catch {
                  /* ignore */
                }
                void load(true, n);
              }}
              className="h-9 text-xs"
            >
              {PAGE_SIZE_PRESETS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {(sumExpense !== null || sumIncome !== null) && (
          <p className="text-[10px] text-[var(--color-text-muted)] px-3 pb-2 pt-2 border-t border-[var(--color-border)]">
            {t('transactions:aggregatesHint')}
          </p>
        )}
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
            <Select value={categoryMergeKey} onChange={(e) => setCategoryMergeKey(e.target.value)}>
              <option value="">{t('transactions:categoryAll')}</option>
              {mergedCategorySelectOptions.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <LocaleMonthField
                value={billMonth}
                max={maxBillMonth}
                onChange={(v) => {
                  setBillMonth(v);
                  if (v) {
                    const b = boundsForYearMonth(v);
                    if (b) {
                      setStartDate(b.start);
                      setEndDate(b.end);
                    }
                  } else {
                    setStartDate('');
                    setEndDate('');
                  }
                }}
                className="h-10 text-xs"
              />
              <LocaleDateField value={startDate} onChange={setStartDate} max={endDate || undefined} className="text-xs" />
              <LocaleDateField value={endDate} onChange={setEndDate} min={startDate || undefined} className="text-xs" />
            </div>
          </div>
          {currentLedger?.type === 'family' && familySplitTargets.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] mb-1.5">
                {t('transactions:filterLedgerLabel')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[{ id: currentLedger.id, name: t('transactions:filterLedgerSelfMain') }, ...familySplitTargets].map((l) => {
                  const active = ledgerFilter.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() =>
                        setLedgerFilter((prev) =>
                          prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                        )
                      }
                      className={`px-2.5 h-7 rounded-full border text-xs transition-colors ${
                        active
                          ? 'bg-[var(--color-brand-soft)] border-[var(--color-brand)] text-[var(--color-brand)]'
                          : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
                      }`}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {activeFilterCount > 0 && (
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" leftIcon={<X size={12} />} onClick={clearFilters}>
                {t('transactions:clearFilters')}
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Split groups (containers) */}
      {showSplitGroups && currentLedger?.type === 'family' && (
        <Card padding="sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {t('transactions:splitGroupsTitle')}
            </h3>
            <span className="text-xs text-[var(--color-text-subtle)]">
              {t('transactions:splitGroupsCount', { count: splitGroups.length })}
            </span>
          </div>
          {loadingSplitGroups ? (
            <div className="flex items-center justify-center py-6 text-[var(--color-text-subtle)]">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : splitGroups.length === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--color-text-subtle)]">
              {t('transactions:splitGroupsEmpty')}
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {splitGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setOpenSplitGroupId(g.id)}
                  className="w-full flex items-center justify-between gap-3 py-2 text-left hover:bg-[var(--color-surface-muted)] rounded-[var(--radius-sm)] px-2 -mx-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Split size={12} className="text-[var(--color-text-subtle)] shrink-0" />
                      <span className="text-xs font-medium text-[var(--color-text)] truncate">
                        {g.note || t('transactions:splitGroupsNoNote')}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">
                      {g.date} · {t('transactions:splitGroupChildCount', { count: g.child_count })}
                    </p>
                  </div>
                  <span className="font-tabular text-sm font-semibold text-[var(--color-text)] shrink-0">
                    ¥{g.total_amount.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {selectedIds.size > 0 && (
        <Card padding="sm" className="border-[var(--color-brand)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--color-text)]">
                {t('transactions:bulkSelectedCount', { count: selectedMutableTransactions.length })}
              </p>
              <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">
                {t('transactions:bulkSelectedTotals', {
                  expense: selectedExpenseTotal.toFixed(2),
                  income: selectedIncomeTotal.toFixed(2),
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                {t('transactions:bulkClearSelection')}
              </Button>
              <Button variant="danger" size="sm" leftIcon={<Trash2 size={14} />} onClick={() => setBulkDeleteOpen(true)}>
                {t('transactions:bulkDelete')}
              </Button>
            </div>
          </div>
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
            <div className="flex items-center justify-between px-5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
              <button
                type="button"
                onClick={selectVisibleMutable}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                {t('transactions:bulkSelectVisible')}
              </button>
              {selectedIds.size > 0 && (
                <span className="text-[11px] text-[var(--color-text-subtle)]">
                  {t('transactions:bulkSelectedCount', { count: selectedMutableTransactions.length })}
                </span>
              )}
            </div>
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
                      const cat = categoryEntityById[tx.category_id];
                      const subName =
                        tx.ledger_id && tx.ledger_id !== currentLedger.id
                          ? ledgers.find((l) => l.id === tx.ledger_id)?.name
                          : null;
                      const canMutate = canMutateInCurrentContext(tx);
                      const selected = selectedIds.has(tx.id);
                      return (
                        <li
                          key={tx.id}
                          className="group flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!canMutate}
                            onChange={() => toggleSelected(tx.id)}
                            title={canMutate ? t('transactions:bulkSelectRow') : t('transactions:bulkSelectReadonly')}
                            className="w-4 h-4 accent-[var(--color-brand)] disabled:opacity-40 shrink-0"
                            aria-label={t('transactions:bulkSelectRow')}
                          />
                          <CategoryIcon name={cat?.icon} color={cat?.color} size={36} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[var(--color-text)] truncate flex items-center gap-1.5 flex-wrap">
                              {categoryLabel(cat) || t('transactions:uncategorized')}
                              {subName && (
                                <span className="text-[10px] text-[var(--color-brand)] shrink-0">· {subName}</span>
                              )}
                              {!canMutate && (
                                <Badge tone="warning" className="!text-[10px] !py-0 !px-1.5 font-normal shrink-0">
                                  {t('transactions:badgeReadonly')}
                                </Badge>
                              )}
                              {tx.installment_group_id && (
                                <Badge tone="info" className="!text-[10px] !py-0 !px-1.5 font-normal shrink-0">
                                  {t('transactions:badgeInstallment')}
                                </Badge>
                              )}
                              {tx.split_group_id && (
                                <button
                                  type="button"
                                  onClick={() => setOpenSplitGroupId(tx.split_group_id!)}
                                  title={t('transactions:badgeSplitTitle')}
                                  className="shrink-0"
                                >
                                  <Badge tone="info" className="!text-[10px] !py-0 !px-1.5 font-normal cursor-pointer hover:underline">
                                    {t('transactions:badgeSplit')}
                                  </Badge>
                                </button>
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
                              aria-disabled={!canMutate}
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
                              className={`w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] ${
                                canMutate ? '' : 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-[var(--color-text-subtle)]'
                              }`}
                            >
                              <Pencil size={13} />
                            </button>
                            {canMutate &&
                              currentLedger?.type === 'family' &&
                              tx.ledger_id === currentLedger.id &&
                              !tx.installment_group_id &&
                              !tx.split_group_id &&
                              familySplitTargets.length > 0 && (
                                <button
                                  type="button"
                                  title={t('transactions:convertToSplitTitle')}
                                  onClick={() => setConvertSplitTx(tx)}
                                  className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
                                >
                                  <Split size={13} />
                                </button>
                              )}
                            {tx.installment_group_id && canMutate && (
                              <button
                                type="button"
                                title={t('transactions:deleteInstallmentGroupTitle')}
                                onClick={async () => {
                                  if (!window.confirm(t('transactions:confirmDeleteInstallment'))) return;
                                  setTxFeedback('');
                                  try {
                                    await api.delete(`/transactions/installment-group/${tx.installment_group_id}`);
                                    load(true);
                                  } catch (err: unknown) {
                                    const msg =
                                      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                                      t('transactions:deleteFailed');
                                    setTxFeedback(msg);
                                  }
                                }}
                                className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
                              >
                                <Layers size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              aria-disabled={!canMutate}
                              onClick={() => {
                                if (!canMutate) {
                                  setTxFeedback(t('transactions:deleteForbiddenMerged'));
                                  return;
                                }
                                setTxFeedback('');
                                setDeleting(tx);
                              }}
                              title={canMutate ? t('common:delete') : t('transactions:deleteForbiddenTitle')}
                              className={`w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] ${
                                canMutate ? '' : 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-[var(--color-text-subtle)]'
                              }`}
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
          splitTargets={currentLedger.type === 'family' ? currentLedger.linked_personal ?? [] : []}
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

      {convertSplitTx && (
        <ConvertToSplitModal
          open
          transaction={{
            id: convertSplitTx.id,
            amount: convertSplitTx.amount,
            note: convertSplitTx.note,
          }}
          splitTargets={familySplitTargets}
          onClose={() => setConvertSplitTx(null)}
          onSuccess={() => {
            setConvertSplitTx(null);
            load(true);
            if (showSplitGroups) void loadSplitGroups();
          }}
        />
      )}

      {openSplitGroupId && (
        <SplitGroupDrawer
          open
          splitGroupId={openSplitGroupId}
          ledgerNameById={ledgerNameById}
          onClose={() => setOpenSplitGroupId(null)}
          onDeleted={() => {
            load(true);
            if (showSplitGroups) void loadSplitGroups();
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
              name={categoryEntityById[deleting.category_id]?.icon}
              color={categoryEntityById[deleting.category_id]?.color}
              size={36}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--color-text)]">
                {categoryLabel(categoryEntityById[deleting.category_id]) || t('transactions:uncategorized')}
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

      <Modal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        size="sm"
        title={t('transactions:bulkConfirmDeleteTitle')}
        description={t('transactions:bulkConfirmDeleteDesc', { count: selectedMutableTransactions.length })}
        footer={
          <>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button variant="danger" loading={bulkDeleting} onClick={confirmBulkDelete}>
              {t('transactions:bulkDelete')}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-[var(--color-text)]">
          <p>{t('transactions:bulkConfirmDeleteImpact')}</p>
          <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
            <p>
              {t('transactions:bulkSelectedTotals', {
                expense: selectedExpenseTotal.toFixed(2),
                income: selectedIncomeTotal.toFixed(2),
              })}
            </p>
            <p className="mt-1">{t('transactions:bulkSplitWarning')}</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
