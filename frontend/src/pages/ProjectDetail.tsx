import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Wallet,
  Pencil,
  Receipt,
  Loader2,
  Calendar,
  PieChart as PieChartIcon,
  Plus,
  Trash2,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import api from '../api/client';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Badge,
  CategoryIcon,
  Modal,
  cn,
} from '../components/ui';
import SpendingChart, { PIE_OTHER_CATEGORY_ID, type PieDatum } from '../components/SpendingChart';
import CategoryLedgerDrillModal, { type LedgerDrillRow } from '../components/CategoryLedgerDrillModal';
import { mergeCategoryStatsForPie } from '../lib/categoryMerge';
import ProjectFormModal from '../components/ProjectFormModal';
import { pickCategoryDisplayName } from '../lib/categoryDisplay';
import ProjectBudgetModal from '../components/ProjectBudgetModal';
import AddRecordModal from '../components/AddRecordModal';
import { useLayout } from '../components/AppLayout';

interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: string;
  note: string;
  ledger_id: string;
  start_date?: string | null;
  end_date?: string | null;
  budget: {
    mode: 'none' | 'total' | 'monthly';
    amount: number;
    year_month?: string;
    ledger_id?: string;
  };
  spent: number;
  spent_total: number;
  remaining: number;
  usage_pct: number;
}

interface CatStat {
  name: string;
  name_zh?: string;
  name_en?: string;
  category_id?: string;
  value: number;
  color: string;
}

interface TxTag {
  id: string;
  name: string;
  color: string;
  exclude_from_stats: boolean;
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

interface Transaction {
  id: string;
  amount: number;
  type: string;
  category_id: string;
  note: string;
  date: string;
  created_at?: string;
  ledger_id?: string;
  project_id?: string | null;
  installment_group_id?: string;
  tag_refs?: TxTag[];
}

const PAGE_SIZE = 50;

function canMutateTransaction(tx: Transaction, fallbackLedgerId: string, mutableIds: Set<string>): boolean {
  const lid = tx.ledger_id || fallbackLedgerId;
  return mutableIds.has(lid);
}

export default function ProjectDetail() {
  const { t, i18n } = useTranslation('projects');
  const { t: tTx } = useTranslation('transactions');
  const { t: tCommon } = useTranslation('common');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { ledgers } = useLayout();

  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [catStats, setCatStats] = useState<CatStat[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [categoryDrillOpen, setCategoryDrillOpen] = useState(false);
  const [categoryDrillTitle, setCategoryDrillTitle] = useState('');
  const [categoryDrillLoading, setCategoryDrillLoading] = useState(false);
  const [categoryDrillRows, setCategoryDrillRows] = useState<LedgerDrillRow[]>([]);

  const mutableLedgerIds = useMemo(() => new Set(ledgers.map((l) => l.id)), [ledgers]);

  const ledgerForTx = useMemo(() => {
    if (!summary) return '';
    if (summary.budget?.mode !== 'none' && summary.budget?.ledger_id) return summary.budget.ledger_id;
    return summary.ledger_id;
  }, [summary]);

  const categoryMap = useMemo(() => {
    const m: Record<string, Category> = {};
    categories.forEach((c) => {
      m[c.id] = c;
    });
    return m;
  }, [categories]);

  const categoryLabel = (c: Category | undefined) =>
    (c && (pickCategoryDisplayName(i18n.language, c.name_zh, c.name_en) || c.name)) || '';

  const chartData = useMemo(() => {
    const merged = mergeCategoryStatsForPie(catStats, categories);
    return merged.map((d) => ({
      ...d,
      name: pickCategoryDisplayName(i18n.language, d.name_zh, d.name_en) || d.name,
    }));
  }, [catStats, categories, i18n.language]);

  const handleProjectCategorySliceClick = useCallback(
    async (row: PieDatum) => {
      if (row.category_id === PIE_OTHER_CATEGORY_ID || !id || !ledgerForTx) return;
      const ids =
        row.category_ids && row.category_ids.length > 0
          ? row.category_ids
          : row.category_id
            ? [row.category_id]
            : [];
      if (ids.length === 0) return;
      setCategoryDrillTitle(row.name);
      setCategoryDrillOpen(true);
      setCategoryDrillLoading(true);
      setCategoryDrillRows([]);
      try {
        const params = new URLSearchParams();
        params.set('category_ids', ids.join(','));
        params.set('period', 'all');
        params.set('ledger_id', ledgerForTx);
        params.set('project_id', id);
        params.set('bypass_tag_filter', 'true');
        const res = await api.get<{ rows: LedgerDrillRow[] }>(
          `/dashboard/category-by-ledger?${params.toString()}`,
        );
        setCategoryDrillRows(res.data.rows || []);
      } catch (e) {
        console.error(e);
        setCategoryDrillRows([]);
      } finally {
        setCategoryDrillLoading(false);
      }
    },
    [id, ledgerForTx],
  );

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const sumRes = await api.get(`/projects/${id}/summary`);
      const data = sumRes.data;
      setSummary(data.project);
      setCatStats(data.category_stats || []);
    } catch (err) {
      console.error('Failed to load project detail', err);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('sprouts:refresh', refresh);
    return () => window.removeEventListener('sprouts:refresh', refresh);
  }, [id]);

  useEffect(() => {
    if (!ledgerForTx) {
      setCategories([]);
      setTxs([]);
      setTxTotal(0);
      return;
    }
    let ignore = false;
    (async () => {
      try {
        const [catRes, txRes] = await Promise.all([
          api.get(`/categories?ledger_id=${ledgerForTx}`),
          api.get(`/transactions`, {
            params: { ledger_id: ledgerForTx, project_id: id, limit: PAGE_SIZE, offset: 0 },
          }),
        ]);
        if (ignore) return;
        setCategories((catRes.data || []) as Category[]);
        const items: Transaction[] = txRes.data?.items || [];
        const total: number = txRes.data?.total ?? items.length;
        setTxs(items);
        setTxTotal(total);
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [ledgerForTx, id]);

  const loadMore = async () => {
    if (!id || !ledgerForTx || txLoading || txs.length >= txTotal) return;
    setTxLoading(true);
    try {
      const res = await api.get(`/transactions`, {
        params: {
          ledger_id: ledgerForTx,
          project_id: id,
          limit: PAGE_SIZE,
          offset: txs.length,
        },
      });
      const items: Transaction[] = res.data?.items || [];
      setTxs((prev) => [...prev, ...items]);
    } catch (err) {
      console.error(err);
    } finally {
      setTxLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/transactions/${deleting.id}`);
      setDeleting(null);
      window.dispatchEvent(new CustomEvent('sprouts:refresh'));
      await load();
      if (ledgerForTx && id) {
        const txRes = await api.get(`/transactions`, {
          params: { ledger_id: ledgerForTx, project_id: id, limit: PAGE_SIZE, offset: 0 },
        });
        const items: Transaction[] = txRes.data?.items || [];
        const total: number = txRes.data?.total ?? items.length;
        setTxs(items);
        setTxTotal(total);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--color-text-subtle)]">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  if (!summary) {
    return (
      <Card>
        <EmptyState title={t('detailNotFound')} />
      </Card>
    );
  }

  const hasBudget = summary.budget.mode !== 'none' && summary.budget.amount > 0;
  const overBudget = hasBudget && summary.spent > summary.budget.amount;
  const usagePct = hasBudget ? Math.min(100, summary.usage_pct) : 0;

  const formatTxDay = (iso: string) => {
    const d = new Date(iso);
    return t('monthDay', { m: d.getMonth() + 1, d: d.getDate() });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => navigate('/projects')}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={14} /> {t('detailBack')}
        </button>
        {ledgerForTx && (
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowAdd(true)}>
            {t('addEntry')}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card padding="lg" className="lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <CategoryIcon name={summary.icon} color={summary.color} size={56} />
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold text-[var(--color-text)] truncate">{summary.name}</h1>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <Badge tone={summary.budget.mode === 'none' ? 'neutral' : 'info'}>
                    {summary.budget.mode === 'none'
                      ? t('budgetMode_none')
                      : summary.budget.mode === 'total'
                        ? t('budgetMode_total')
                        : t('budgetMode_monthly')}
                  </Badge>
                  {summary.status === 'archived' && <Badge tone="neutral">{t('archived')}</Badge>}
                  {summary.start_date && (
                    <span className="text-[11px] text-[var(--color-text-subtle)] font-tabular">
                      <Calendar size={10} className="inline mr-1" />
                      {new Date(summary.start_date).toLocaleDateString()}
                      {summary.end_date && ` → ${new Date(summary.end_date).toLocaleDateString()}`}
                    </span>
                  )}
                </div>
                {summary.note && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-2 leading-relaxed">{summary.note}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <Button size="sm" leftIcon={<Wallet size={14} />} onClick={() => setEditingBudget(true)}>
                {t('detailEditBudget')}
              </Button>
              <Button size="sm" variant="outline" leftIcon={<Pencil size={14} />} onClick={() => setEditing(true)}>
                {t('detailEditInfo')}
              </Button>
            </div>
          </div>

          {hasBudget ? (
            <div className="mt-5 space-y-2 pt-5 border-t border-[var(--color-border)]">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">
                  {summary.budget.mode === 'monthly'
                    ? t('spentMonthly', { ym: summary.budget.year_month ?? '' })
                    : t('spentCumulative')}
                </span>
                <span className={cn('text-lg font-semibold font-tabular', overBudget ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]')}>
                  ¥{summary.spent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-[var(--color-text-subtle)] font-normal">
                    {' '}/ ¥{summary.budget.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-[var(--color-surface-muted)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${usagePct}%`,
                    background: overBudget ? 'var(--color-danger)' : summary.color || 'var(--color-brand)',
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <Badge tone={overBudget ? 'danger' : usagePct > 80 ? 'warning' : 'success'} dot>
                  {overBudget ? t('healthOver') : usagePct > 80 ? t('healthWarn') : t('healthOk')}
                </Badge>
                <span className="text-[var(--color-text-subtle)] font-tabular">
                  {t('remainingYuan', {
                    amount: Math.max(0, summary.budget.amount - summary.spent).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }),
                  })}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-5 pt-5 border-t border-[var(--color-border)]">
              <EmptyState
                icon={<Wallet size={16} />}
                title={t('detailNoBudgetTitle')}
                description={t('detailNoBudgetDesc')}
                action={
                  <Button size="sm" onClick={() => setEditingBudget(true)}>
                    {t('detailSetBudget')}
                  </Button>
                }
              />
            </div>
          )}
        </Card>

        <Card padding="lg" className="flex flex-col gap-3">
          <CardHeader icon={<Receipt size={16} />} title={t('totalsTitle')} description={t('totalsDesc')} />
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('totalExpense')}</p>
              <p className="text-base font-semibold font-tabular text-[var(--color-text)] mt-1">
                ¥{summary.spent_total.toLocaleString()}
              </p>
            </div>
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('txCount')}</p>
              <p className="text-base font-semibold font-tabular text-[var(--color-text)] mt-1">{txTotal}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3" padding="lg">
          <CardHeader
            icon={<PieChartIcon size={16} />}
            title={t('breakdownTitle')}
            description={
              summary.budget.mode !== 'none' &&
              summary.budget.ledger_id &&
              summary.budget.ledger_id !== summary.ledger_id
                ? t('breakdownDescAlt')
                : t('breakdownDescDefault')
            }
          />
          <div className="mt-4">
            <SpendingChart
              data={chartData}
              totalLabel={t('chartTotal')}
              emptyTitle={t('chartEmptyTitle')}
              emptyDescription={t('chartEmptyDesc')}
              onSliceClick={handleProjectCategorySliceClick}
            />
          </div>
        </Card>
      </div>

      <Card padding="lg">
        <CardHeader icon={<Receipt size={16} />} title={t('txListTitle')} description={t('txListDesc')} />
        <div className="mt-3">
          {txs.length === 0 && !txLoading ? (
            <EmptyState icon={<Receipt size={18} />} title={t('recentEmpty')} />
          ) : (
            <>
              <ul className="divide-y divide-[var(--color-border)]">
                {txs.map((tx) => {
                  const cat = categoryMap[tx.category_id];
                  const canMut = canMutateTransaction(tx, ledgerForTx, mutableLedgerIds);
                  return (
                    <li
                      key={tx.id}
                      className="group flex items-center gap-3 py-3 hover:bg-[var(--color-surface-hover)] rounded-[var(--radius-md)] px-2 -mx-2"
                    >
                      <CategoryIcon name={cat?.icon} color={cat?.color} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--color-text)] truncate flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium">{categoryLabel(cat) || tTx('uncategorized')}</span>
                          {tx.installment_group_id && (
                            <Badge tone="info" className="!text-[10px] !py-0 !px-1.5 font-normal shrink-0">
                              {tTx('badgeInstallment')}
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
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tg.color || '#a78bfa' }} />
                                {tg.name}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-[11px] text-[var(--color-text-subtle)] font-tabular mt-0.5">{formatTxDay(tx.date)}</p>
                      </div>
                      <span
                        className={cn(
                          'text-sm font-semibold font-tabular shrink-0',
                          tx.type === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--color-text)]',
                        )}
                      >
                        {tx.type === 'income' ? '+' : '-'}¥
                        {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                        <button
                          type="button"
                          disabled={!canMut}
                          title={tTx('edit')}
                          onClick={() => canMut && setEditingTx(tx)}
                          className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] disabled:opacity-30"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={!canMut}
                          title={tTx('delete')}
                          onClick={() => canMut && setDeleting(tx)}
                          className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {txs.length < txTotal && (
                <div className="mt-3 flex justify-center">
                  <Button variant="outline" size="sm" loading={txLoading} onClick={() => void loadMore()}>
                    {t('loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {editing && (
        <ProjectFormModal
          open
          ledgerId={summary.ledger_id}
          initial={summary}
          onClose={() => setEditing(false)}
          onSuccess={() => {
            setEditing(false);
            load();
          }}
        />
      )}
      {editingBudget && (
        <ProjectBudgetModal
          open
          project={summary}
          onClose={() => setEditingBudget(false)}
          onSuccess={() => {
            setEditingBudget(false);
            load();
          }}
        />
      )}

      {showAdd && ledgerForTx && id && (
        <AddRecordModal
          open
          ledgerId={ledgerForTx}
          defaultProjectId={id}
          onClose={() => setShowAdd(false)}
          onSuccess={() => {
            setShowAdd(false);
            window.dispatchEvent(new CustomEvent('sprouts:refresh'));
            void load();
            if (ledgerForTx && id) {
              void api
                .get(`/transactions`, {
                  params: { ledger_id: ledgerForTx, project_id: id, limit: PAGE_SIZE, offset: 0 },
                })
                .then((txRes) => {
                  const items: Transaction[] = txRes.data?.items || [];
                  const total: number = txRes.data?.total ?? items.length;
                  setTxs(items);
                  setTxTotal(total);
                });
            }
          }}
        />
      )}

      {editingTx && ledgerForTx && (
        <AddRecordModal
          open
          ledgerId={editingTx.ledger_id || ledgerForTx}
          initial={{
            id: editingTx.id,
            amount: editingTx.amount,
            type: editingTx.type,
            category_id: editingTx.category_id,
            note: editingTx.note,
            date: editingTx.date,
            project_id: editingTx.project_id ?? id,
            tag_ids: editingTx.tag_refs?.map((x) => x.id) ?? [],
          }}
          onClose={() => setEditingTx(null)}
          onSuccess={() => {
            setEditingTx(null);
            window.dispatchEvent(new CustomEvent('sprouts:refresh'));
            void load();
            if (ledgerForTx && id) {
              void api
                .get(`/transactions`, {
                  params: { ledger_id: ledgerForTx, project_id: id, limit: PAGE_SIZE, offset: 0 },
                })
                .then((txRes) => {
                  const items: Transaction[] = txRes.data?.items || [];
                  const total: number = txRes.data?.total ?? items.length;
                  setTxs(items);
                  setTxTotal(total);
                });
            }
          }}
        />
      )}

      <Modal
        open={!!deleting}
        onClose={() => !deleteLoading && setDeleting(null)}
        size="sm"
        title={tTx('confirmDeleteTitle')}
        description={tTx('confirmDeleteDesc')}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteLoading}>
              {tCommon('cancel')}
            </Button>
            <Button variant="danger" loading={deleteLoading} onClick={() => void confirmDelete()}>
              {tCommon('delete')}
            </Button>
          </>
        }
      >
        {deleting && (
          <p className="text-sm text-[var(--color-text)]">
            {categoryLabel(categoryMap[deleting.category_id]) || tTx('uncategorized')} · ¥{deleting.amount.toFixed(2)}
          </p>
        )}
      </Modal>

      <CategoryLedgerDrillModal
        open={categoryDrillOpen}
        onClose={() => setCategoryDrillOpen(false)}
        title={categoryDrillTitle}
        loading={categoryDrillLoading}
        rows={categoryDrillRows}
      />
    </div>
  );
}
