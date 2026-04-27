import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import api from '../api/client';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Badge,
  CategoryIcon,
  cn,
} from '../components/ui';
import SpendingChart from '../components/SpendingChart';
import ProjectFormModal from '../components/ProjectFormModal';
import ProjectBudgetModal from '../components/ProjectBudgetModal';

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
  value: number;
  color: string;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  category_id: string;
  note: string;
  date: string;
}

export default function ProjectDetail() {
  const { t } = useTranslation('projects');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [catStats, setCatStats] = useState<CatStat[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const sumRes = await api.get(`/projects/${id}/summary`);
      const data = sumRes.data;
      setSummary(data.project);
      setCatStats(data.category_stats || []);

      // Prefer the ledger used for budget burn-down when set; else project's home ledger
      const proj = data.project as ProjectSummary;
      const ledgerForTx =
        proj.budget?.mode !== 'none' && proj.budget?.ledger_id
          ? proj.budget.ledger_id
          : proj.ledger_id;
      if (ledgerForTx) {
        const listRes = await api.get(`/transactions`, {
          params: { ledger_id: ledgerForTx, limit: 200 },
        });
        const items = Array.isArray(listRes.data) ? listRes.data : listRes.data?.items || [];
        const related = items.filter((t: any) => t.project_id === id);
        setTxs(related.slice(0, 20));
      } else {
        setTxs([]);
      }
    } catch (err) {
      console.error('Failed to load project detail', err);
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
      <div>
        <button
          onClick={() => navigate('/projects')}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={14} /> {t('detailBack')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hero card */}
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

          {/* Budget progress */}
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

        {/* Totals */}
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
              <p className="text-base font-semibold font-tabular text-[var(--color-text)] mt-1">{txs.length}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Chart + recent */}
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
              data={catStats}
              totalLabel={t('chartTotal')}
              emptyTitle={t('chartEmptyTitle')}
              emptyDescription={t('chartEmptyDesc')}
            />
          </div>
        </Card>

        <Card className="lg:col-span-2" padding="lg">
          <CardHeader icon={<Receipt size={16} />} title={t('recentTitle')} description={t('recentDesc')} />
          <div className="mt-3">
            {txs.length === 0 ? (
              <EmptyState icon={<Receipt size={18} />} title={t('recentEmpty')} />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {txs.map((tx) => (
                  <li key={tx.id} className="flex items-center gap-2 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--color-text)] truncate">
                        {tx.note || t('noNote')}
                      </p>
                      <p className="text-[11px] text-[var(--color-text-subtle)] font-tabular mt-0.5">
                        {formatTxDay(tx.date)}
                      </p>
                    </div>
                    <span className={cn('text-sm font-semibold font-tabular shrink-0', tx.type === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--color-text)]')}>
                      {tx.type === 'income' ? '+' : '-'}¥{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

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
    </div>
  );
}
