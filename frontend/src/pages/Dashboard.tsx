import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Wallet,
  TrendingDown,
  Calendar,
  PieChart as PieChartIcon,
  ArrowUpRight,
  Pencil,
  Receipt,
  Loader2,
  Sparkles,
  Layers,
  Tag,
  FolderKanban,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Infinity as InfinityIcon,
  Book,
  BarChart2,
  TrendingUp,
  TrendingDown as TrendingDownIcon,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip as RechartsTooltip,
  XAxis,
} from 'recharts';
import { cn } from '../components/ui';
import api from '../api/client';
import SpendingChart from '../components/SpendingChart';
import EditBudgetModal from '../components/EditBudgetModal';
import { LocaleMonthField } from '../components/LocalePickers';
import { Button, Card, CardHeader, EmptyState, Badge, CategoryIcon } from '../components/ui';
import { useLayout, type Ledger } from '../components/AppLayout';
import {
  mergeTagsByNormalizedName,
  togglableTagIds,
  allTogglableManuallyExcluded,
  everyMemberDefaultExcluded,
  type TagWithLedger,
  type MergedTagGroup,
} from '../lib/mergeClusterTags';
import { pickCategoryDisplayName } from '../lib/categoryDisplay';
import { mergeCategoryStatsForPie } from '../lib/categoryMerge';
import CategoryLedgerDrillModal, { type LedgerDrillRow } from '../components/CategoryLedgerDrillModal';
import { PIE_OTHER_CATEGORY_ID, type PieDatum } from '../components/SpendingChart';

interface CategoryStat {
  name: string;
  name_zh?: string;
  name_en?: string;
  category_id?: string;
  value: number;
  color: string;
}

interface TagRef {
  id: string;
  name: string;
  color: string;
  exclude_from_stats: boolean;
  ledger_id?: string;
}

interface Summary {
  total_budget: number;
  total_expense: number;
  remaining_budget: number;
  days_left: number;
  daily_avg_limit: number;
  current_month: string;
  year?: number;
  period?: Period;
  category_stats: CategoryStat[];
  project_stats?: CategoryStat[];
  ledger_stats?: CategoryStat[];
  ledger_count?: number;
  excluded_tags?: TagRef[];
  bypass_tag_filter?: boolean;
  /** True when viewing a family ledger and expenses aggregate linked personal books you can access */
  includes_linked_personal?: boolean;
  linked_personal_in_cluster?: number;
  is_current_month?: boolean;
  compare?: CompareData | null;
}

interface DailyStat {
  date: string;
  expense: number;
  income: number;
}

interface TopMoverItem {
  category_id: string;
  name: string;
  prev: number;
  curr: number;
  delta: number;
}

interface CompareData {
  today_expense: number;
  yesterday_expense: number;
  today_remaining: number;
  prev_period_expense: number;
  yoy_expense: number;
  daily_series: DailyStat[];
  top_movers_up: TopMoverItem[];
  top_movers_down: TopMoverItem[];
}

type Scope = 'current' | 'all';
type GroupBy = 'category' | 'project' | 'ledger';
type Period = 'month' | 'year' | 'all';

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
  ledger_id?: string;
}

function ledgerClusterIds(ledger: Ledger): string[] {
  if (ledger.type !== 'family') return [ledger.id];
  return [ledger.id, ...(ledger.linked_personal || []).map((p) => p.id)];
}

function formatYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function clampYearMonthToNow(ym: string): string {
  const cap = formatYearMonth(new Date());
  return ym > cap ? cap : ym;
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

function mergeById<T extends { id: string }>(lists: T[][]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
  }
  return out;
}

interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
      {items.map((it) => {
        const active = value === it.value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors',
              active
                ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]',
            )}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function formatDateShort(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return t('dashboard:today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return t('dashboard:yesterday');
  }
  return t('dashboard:monthDay', { m: d.getMonth() + 1, d: d.getDate() });
}

export default function Dashboard() {
  const { t, i18n } = useTranslation('dashboard');
  const { currentLedger, ledgers, setCurrentLedger } = useLayout();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBudget, setShowBudget] = useState(false);
  const [scope, setScope] = useState<Scope>('current');
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const [period, setPeriod] = useState<Period>('month');
  const [selectedYearMonth, setSelectedYearMonth] = useState(() => formatYearMonth(new Date()));
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const yearNavChoices = React.useMemo(() => {
    const cy = new Date().getFullYear();
    return Array.from({ length: 16 }, (_, i) => cy - i);
  }, []);

  // Tag filter state. `bypassTagFilter` trumps `manualExcludeTagIds`:
  // when true, the dashboard shows EVERYTHING including tags flagged as
  // "默认排除". Manual tag ids are additive to the defaults.
  const [bypassTagFilter, setBypassTagFilter] = useState(false);
  const [manualExcludeTagIds, setManualExcludeTagIds] = useState<string[]>([]);
  /** Flat tags from cluster fetch (includes ledger_id for merge + tooltips). */
  const [tagFlat, setTagFlat] = useState<TagWithLedger[]>([]);

  const [showCompare, setShowCompare] = useState(() => localStorage.getItem('dashboard_show_compare') === 'true');

  const [categoryDrillOpen, setCategoryDrillOpen] = useState(false);
  const [categoryDrillTitle, setCategoryDrillTitle] = useState('');
  const [categoryDrillLoading, setCategoryDrillLoading] = useState(false);
  const [categoryDrillRows, setCategoryDrillRows] = useState<LedgerDrillRow[]>([]);

  const categoryMap = React.useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => (map[c.id] = c));
    return map;
  }, [categories]);

  const categoryLabel = (c: Category | undefined) =>
    (c && (pickCategoryDisplayName(i18n.language, c.name_zh, c.name_en) || c.name)) || '';

  const ledgerLabelById = React.useMemo(() => {
    const m: Record<string, string> = {};
    if (!currentLedger) return m;
    m[currentLedger.id] = currentLedger.name;
    (currentLedger.linked_personal || []).forEach((p) => {
      m[p.id] = p.name;
    });
    ledgers.forEach((l) => {
      if (!m[l.id]) m[l.id] = l.name;
    });
    return m;
  }, [currentLedger, ledgers]);

  const tagDisplayGroups = React.useMemo(() => mergeTagsByNormalizedName(tagFlat), [tagFlat]);

  /** Recompute slice labels when UI language changes (summary.name is request-locale snapshot). */
  const spendingChartData = React.useMemo(() => {
    const bundle =
      groupBy === 'category'
        ? summary?.category_stats
        : groupBy === 'project'
          ? summary?.project_stats
          : summary?.ledger_stats;
    const raw = bundle || [];
    if (groupBy !== 'category') return raw;
    const merged = mergeCategoryStatsForPie(raw, categories);
    return merged.map((d) => ({
      ...d,
      name: pickCategoryDisplayName(i18n.language, d.name_zh, d.name_en) || d.name,
    }));
  }, [summary, groupBy, i18n.language, categories]);

  const load = async (ledger: Ledger) => {
    try {
      setLoading(true);
      const sumParams = new URLSearchParams({ group_by: groupBy, period });
      if (period === 'month') {
        sumParams.set('year_month', selectedYearMonth);
      } else if (period === 'year') {
        sumParams.set('year', String(selectedYear));
      }
      if (scope === 'all') {
        sumParams.set('scope', 'all');
      } else {
        sumParams.set('ledger_id', ledger.id);
      }
      if (showCompare && period === 'month' && scope === 'current') {
        sumParams.set('compare', 'true');
      }
      if (bypassTagFilter) {
        sumParams.set('bypass_tag_filter', 'true');
      } else if (manualExcludeTagIds.length > 0) {
        sumParams.set('exclude_tag_ids', manualExcludeTagIds.join(','));
      }
      const cluster = ledgerClusterIds(ledger);
      let txUrl = `/transactions?ledger_id=${ledger.id}&limit=5`;
      if (period === 'month') {
        const b = boundsForYearMonth(selectedYearMonth);
        if (b) {
          txUrl += `&start_date=${b.start}&end_date=${b.end}`;
        }
      }
      const [sumRes, txRes, catResults, tagResults] = await Promise.all([
        api.get(`/dashboard/summary?${sumParams.toString()}`),
        api.get(txUrl),
        Promise.all(cluster.map((id) => api.get(`/categories?ledger_id=${id}`))),
        Promise.all(cluster.map((id) => api.get(`/tags?ledger_id=${id}`))),
      ]);
      setSummary(sumRes.data);
      setCategories(mergeById(catResults.map((r) => r.data || [])));
      const txs = Array.isArray(txRes.data) ? txRes.data : txRes.data?.items || [];
      setRecent(txs.slice(0, 5));
      const flatTags: TagWithLedger[] = [];
      cluster.forEach((lid, i) => {
        const rows = (tagResults[i]?.data || []) as TagRef[];
        for (const t of rows) {
          flatTags.push({
            id: t.id,
            name: t.name,
            color: t.color,
            exclude_from_stats: t.exclude_from_stats,
            ledger_id: lid,
          });
        }
      });
      setTagFlat(flatTags);
    } catch (err) {
      console.error('Failed to load dashboard', err);
    } finally {
      setLoading(false);
    }
  };

  const linkedKey = [
    currentLedger?.linked_personal?.map((p) => p.id).join(',') ?? '',
    currentLedger?.linked_personal_count ?? 0,
  ].join('|');

  useEffect(() => {
    if (currentLedger) void load(currentLedger);
    const refresh = () => currentLedger && void load(currentLedger);
    window.addEventListener('sprouts:refresh', refresh);
    return () => window.removeEventListener('sprouts:refresh', refresh);
  }, [
    currentLedger?.id,
    currentLedger?.type,
    linkedKey,
    scope,
    groupBy,
    period,
    showCompare,
    bypassTagFilter,
    manualExcludeTagIds.join(','),
    selectedYearMonth,
    selectedYear,
  ]);

  const shiftSelectedMonth = (delta: number) => {
    const m = selectedYearMonth.match(/^(\d{4})-(\d{2})$/);
    if (!m) return;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = new Date(y, mo - 1 + delta, 1);
    setSelectedYearMonth(clampYearMonthToNow(formatYearMonth(d)));
  };

  const maxYearMonth = formatYearMonth(new Date());

  const toggleManualExcludeTag = (id: string) => {
    setManualExcludeTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const toggleMergedManualExclude = (group: MergedTagGroup) => {
    const ids = togglableTagIds(group);
    if (ids.length === 0) return;
    const allIn = allTogglableManuallyExcluded(group, manualExcludeTagIds);
    setManualExcludeTagIds((prev) => {
      if (allIn) {
        return prev.filter((id) => !ids.includes(id));
      }
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const handleCategorySliceClick = useCallback(
    async (row: PieDatum) => {
      if (row.category_id === PIE_OTHER_CATEGORY_ID) return;
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
        params.set('period', period);
        if (period === 'month') params.set('year_month', selectedYearMonth);
        else if (period === 'year') params.set('year', String(selectedYear));
        if (scope === 'all') params.set('scope', 'all');
        else if (currentLedger) params.set('ledger_id', currentLedger.id);
        if (bypassTagFilter) params.set('bypass_tag_filter', 'true');
        else if (manualExcludeTagIds.length > 0) params.set('exclude_tag_ids', manualExcludeTagIds.join(','));
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
    [
      period,
      selectedYearMonth,
      scope,
      currentLedger,
      bypassTagFilter,
      manualExcludeTagIds,
    ],
  );

  if (!currentLedger) {
    return (
      <Card>
        <EmptyState
          icon={<Wallet size={18} />}
          title={t('dashboard:noLedgerTitle')}
          description={t('dashboard:noLedgerDesc')}
        />
      </Card>
    );
  }

  if (loading && !summary) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-[var(--color-text-subtle)]">
        <Loader2 className="animate-spin" size={24} />
        <p className="text-xs">{t('dashboard:loadingLedgers')}</p>
      </div>
    );
  }

  const budget = summary?.total_budget ?? 0;
  const expense = summary?.total_expense ?? 0;
  const remaining = summary?.remaining_budget ?? 0;
  // For progress comparisons: budget is month-scoped, so use period=month expense;
  // otherwise fall back to remaining which the backend already computed off the current month.
  const monthExpenseForBar = period === 'month' ? expense : Math.max(0, budget - remaining);
  const usagePct = budget > 0 ? Math.min(100, (monthExpenseForBar / budget) * 100) : 0;
  const overBudget = budget > 0 && monthExpenseForBar > budget;

  const periodLabel =
    period === 'month'
      ? summary?.current_month ?? ''
      : period === 'year'
        ? t('dashboard:allYear', { year: summary?.year ?? new Date().getFullYear() })
        : t('dashboard:allTime');
  const expenseLabel =
    period === 'month' && summary?.is_current_month === false
      ? t('dashboard:expenseSelectedMonth')
      : period === 'month'
        ? t('dashboard:expenseThisMonth')
        : period === 'year'
          ? t('dashboard:expenseThisYear')
          : t('dashboard:expenseTotal');
  const totalLabel = expenseLabel;
  const chartGroupKey =
    groupBy === 'category' ? 'chartDescCategory' : groupBy === 'project' ? 'chartDescProject' : 'chartDescLedger';
  const chartExpenseKey =
    period === 'month' && summary?.is_current_month === false
      ? 'expenseSelectedMonth'
      : period === 'month'
        ? 'expenseThisMonth'
        : period === 'year'
          ? 'expenseThisYear'
          : 'expenseTotal';
  const chartDescription = t('dashboard:chartLine', {
    group: t(`dashboard:${chartGroupKey}`),
    expense: t(`dashboard:${chartExpenseKey}`),
    cross: scope === 'all' ? t('dashboard:chartCross') : '',
  });

  const mergedFamilyRecent =
    currentLedger.type === 'family' &&
    ((currentLedger.linked_personal_count ?? 0) > 0 || (currentLedger.linked_personal?.length ?? 0) > 0);

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-widest">
            {periodLabel} ·{' '}
            {scope === 'all'
              ? t('dashboard:allLedgersCount', { count: summary?.ledger_count ?? 0 })
              : currentLedger.name}
          </p>
          <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">{t('dashboard:title')}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl<Period>
            items={[
              { value: 'month', label: t('dashboard:periodMonth'), icon: <CalendarDays size={12} /> },
              { value: 'year', label: t('dashboard:periodYear'), icon: <CalendarRange size={12} /> },
              { value: 'all', label: t('dashboard:periodAll'), icon: <InfinityIcon size={12} /> },
            ]}
            value={period}
            onChange={setPeriod}
          />
          {period === 'month' && (
            <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
              <button
                type="button"
                aria-label={t('dashboard:prevMonth')}
                onClick={() => shiftSelectedMonth(-1)}
                className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
              >
                <ChevronLeft size={16} />
              </button>
              <LocaleMonthField
                value={selectedYearMonth}
                max={maxYearMonth}
                allowClear={false}
                onChange={(v) => {
                  if (!v) return;
                  setSelectedYearMonth(clampYearMonthToNow(v));
                }}
                className="h-8 min-w-[9.5rem] !rounded-none !border-0 !bg-transparent !shadow-none px-1 text-xs"
              />
              <button
                type="button"
                aria-label={t('dashboard:nextMonth')}
                disabled={selectedYearMonth >= maxYearMonth}
                onClick={() => shiftSelectedMonth(1)}
                className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          {period === 'year' && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-8 px-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-tabular text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
            >
              {yearNavChoices.map((y) => (
                <option key={y} value={y}>
                  {t('dashboard:yearOption', { year: y })}
                </option>
              ))}
            </select>
          )}
          <SegmentedControl<Scope>
            items={[
              { value: 'current', label: t('dashboard:scopeCurrent'), icon: <Wallet size={12} /> },
              { value: 'all', label: t('dashboard:scopeAll'), icon: <Layers size={12} /> },
            ]}
            value={scope}
            onChange={(v) => {
              setScope(v);
              if (v === 'current' && groupBy === 'ledger') setGroupBy('category');
            }}
          />
          <SegmentedControl<GroupBy>
            items={[
              { value: 'category', label: t('dashboard:groupCategory'), icon: <Tag size={12} /> },
              { value: 'project', label: t('dashboard:groupProject'), icon: <FolderKanban size={12} /> },
              ...(scope === 'all'
                ? [{ value: 'ledger' as GroupBy, label: t('dashboard:groupLedger'), icon: <Book size={12} /> }]
                : []),
            ]}
            value={groupBy}
            onChange={setGroupBy}
          />
          {period === 'month' && scope === 'current' && (
            <button
              type="button"
              onClick={() => {
                const next = !showCompare;
                setShowCompare(next);
                localStorage.setItem('dashboard_show_compare', String(next));
              }}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] border text-xs font-medium transition-colors',
                showCompare
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              )}
            >
              <BarChart2 size={14} />
              {t('dashboard:compareToggle')}
            </button>
          )}
          {scope === 'current' && period === 'month' && (
            <Button variant="outline" size="sm" leftIcon={<Pencil size={14} />} onClick={() => setShowBudget(true)}>
              {t('dashboard:editBudget')}
            </Button>
          )}
        </div>
      </div>

      {scope === 'current' &&
        currentLedger.type === 'family' &&
        ((currentLedger.linked_personal_count ?? 0) > 0 || (currentLedger.linked_personal?.length ?? 0) > 0) && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60">
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              {summary?.includes_linked_personal ? (
                <>
                  {t('dashboard:familyMergePrefix')}
                  <span className="font-medium text-[var(--color-text)]">
                    {t('dashboard:familyMergeHighlight', { count: summary.linked_personal_in_cluster ?? 0 })}
                  </span>
                  {t('dashboard:familyMergeSuffix')}
                </>
              ) : (
                <>{t('dashboard:familyMergePending')}</>
              )}
            </p>
            <div className="flex flex-wrap gap-2 shrink-0">
              {(currentLedger.linked_personal || []).map((sub) => {
                const full = ledgers.find((x) => x.id === sub.id);
                if (!full) return null;
                return (
                  <Button
                    key={sub.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentLedger(full)}
                  >
                    {t('dashboard:openSub', { name: sub.name })}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Budget hero card */}
        <Card className="lg:col-span-2 relative overflow-hidden" padding="lg">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-widest flex items-center gap-1.5">
                <Wallet size={12} /> {t('dashboard:remainingBudget')}
              </p>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-semibold font-tabular ${overBudget ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'}`}>
                  ¥{remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {budget > 0 && (
                  <Badge tone={overBudget ? 'danger' : usagePct > 80 ? 'warning' : 'success'}>
                    {overBudget ? t('dashboard:overBudget') : t('dashboard:usedPct', { pct: usagePct.toFixed(0) })}
                  </Badge>
                )}
              </div>
            </div>
            {budget === 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowBudget(true)}>
                {t('dashboard:setBudget')}
              </Button>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-5 space-y-2">
            <div className="h-2 rounded-full bg-[var(--color-surface-muted)] overflow-hidden">
              <div
                className="h-full transition-all duration-700 rounded-full"
                style={{
                  width: `${Math.min(100, usagePct)}%`,
                  background: overBudget
                    ? 'var(--color-danger)'
                    : 'linear-gradient(90deg, var(--color-brand), #818cf8)',
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--color-text-subtle)]">
              <span>{t('dashboard:spent', { amount: expense.toLocaleString() })}</span>
              <span>{t('dashboard:budgetLine', { amount: budget.toLocaleString() })}</span>
            </div>
          </div>

          {/* Sub stats */}
          <div className="mt-5 grid grid-cols-3 gap-3 pt-5 border-t border-[var(--color-border)]">
            <div>
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{expenseLabel}</p>
              <p className="text-sm font-semibold font-tabular text-[var(--color-text)] mt-1">
                ¥{expense.toLocaleString()}
              </p>
            </div>
            {period === 'month' && summary?.is_current_month === false ? (
              <div className="col-span-2 flex flex-col justify-center">
                <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">
                  {t('dashboard:historicalMonthHint')}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">{t('dashboard:daysDailyN/a')}</p>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider flex items-center gap-1">
                    <Calendar size={11} /> {t('dashboard:daysLeftLabel')}
                  </p>
                  <p className="text-sm font-semibold font-tabular text-[var(--color-text)] mt-1">
                    {summary?.days_left ?? 0} {t('dashboard:daysUnit')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider flex items-center gap-1">
                    <Sparkles size={11} /> {t('dashboard:dailyLimit')}
                  </p>
                  <p
                    className={`text-sm font-semibold font-tabular mt-1 ${summary && summary.daily_avg_limit < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-brand)]'}`}
                  >
                    ¥{(summary?.daily_avg_limit ?? 0).toFixed(2)}
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Quick stats card */}
        <Card padding="lg" className="flex flex-col justify-between">
          <div>
            <CardHeader
              icon={<TrendingDown size={16} />}
              title={t('dashboard:pulseTitle')}
              description={t('dashboard:pulseDesc')}
            />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between py-2.5 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
                <span className="text-xs text-[var(--color-text-muted)]">{t('dashboard:metricCategories')}</span>
                <span className="text-sm font-medium font-tabular">{summary?.category_stats?.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
                <span className="text-xs text-[var(--color-text-muted)]">{t('dashboard:metricShare')}</span>
                <span className="text-sm font-medium font-tabular">
                  {budget > 0 ? `${usagePct.toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
                <span className="text-xs text-[var(--color-text-muted)]">{t('dashboard:metricHealth')}</span>
                <Badge tone={overBudget ? 'danger' : usagePct > 80 ? 'warning' : 'success'} dot>
                  {overBudget ? t('dashboard:healthOver') : usagePct > 80 ? t('dashboard:healthWarn') : t('dashboard:healthOk')}
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Compare section */}
      {showCompare && summary?.compare && (
        <Card padding="lg" className="space-y-4">
          <CardHeader
            icon={<BarChart2 size={16} />}
            title={t('dashboard:compareTitle')}
          />
          {/* Today vs Yesterday row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('dashboard:todayExpense')}</p>
              <p className="text-sm font-semibold font-tabular mt-1">¥{(summary.compare.today_expense ?? 0).toFixed(2)}</p>
            </div>
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('dashboard:yesterdayExpense')}</p>
              <p className="text-sm font-semibold font-tabular mt-1">¥{(summary.compare.yesterday_expense ?? 0).toFixed(2)}</p>
            </div>
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('dashboard:todayRemaining')}</p>
              <p className={`text-sm font-semibold font-tabular mt-1 ${(summary.compare.today_remaining ?? 0) < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-brand)]'}`}>
                ¥{(summary.compare.today_remaining ?? 0).toFixed(2)}
              </p>
            </div>
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              {(() => {
                const curr = summary.total_expense;
                const prev = summary.compare.prev_period_expense ?? 0;
                const delta = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
                const up = delta >= 0;
                return (
                  <>
                    <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('dashboard:prevPeriod')}</p>
                    <p className="text-sm font-semibold font-tabular mt-1 flex items-center gap-1">
                      ¥{prev.toFixed(2)}
                      {prev > 0 && (
                        <span className={`text-[10px] ${up ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}`}>
                          {up ? <TrendingUp size={10} /> : <TrendingDownIcon size={10} />}
                          {up ? '+' : ''}{delta.toFixed(1)}%
                        </span>
                      )}
                    </p>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Daily sparkline */}
          {summary.compare.daily_series?.length > 0 && (
            <div>
              <p className="text-xs text-[var(--color-text-muted)] mb-2">{t('dashboard:dailyTrend')}</p>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={summary.compare.daily_series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="cmpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-brand)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <RechartsTooltip
                    contentStyle={{ fontSize: 11, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                    formatter={(v: number) => [`¥${v.toFixed(2)}`]}
                    labelFormatter={(l) => l}
                  />
                  <Area type="monotone" dataKey="expense" stroke="var(--color-brand)" fill="url(#cmpGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top movers */}
          {(summary.compare.top_movers_up?.length > 0 || summary.compare.top_movers_down?.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {summary.compare.top_movers_up?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[var(--color-danger)] mb-2 flex items-center gap-1"><TrendingUp size={12} /> {t('dashboard:topMoversUp')}</p>
                  <ul className="space-y-1.5">
                    {summary.compare.top_movers_up.map((m) => (
                      <li key={m.category_id} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--color-text-muted)] truncate">{m.name}</span>
                        <span className="font-tabular text-[var(--color-danger)] shrink-0">+¥{Math.abs(m.delta ?? 0).toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.compare.top_movers_down?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[var(--color-success)] mb-2 flex items-center gap-1"><TrendingDownIcon size={12} /> {t('dashboard:topMoversDown')}</p>
                  <ul className="space-y-1.5">
                    {summary.compare.top_movers_down.map((m) => (
                      <li key={m.category_id} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--color-text-muted)] truncate">{m.name}</span>
                        <span className="font-tabular text-[var(--color-success)] shrink-0">¥{(m.delta ?? 0).toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Tag filter (always shown so users can discover and manage
          exclusions, even before any tag exists). */}
      <Card padding="md" className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] shrink-0">
          <Tag size={12} /> {t('dashboard:tagFilter')}
        </div>

        {tagFlat.length === 0 ? (
          <p className="text-[11px] text-[var(--color-text-subtle)]">
            {t('dashboard:tagEmptyHint')}
            <a
              href="/categories"
              onClick={(e) => {
                e.preventDefault();
                navigate('/categories');
              }}
              className="text-[var(--color-brand)] hover:underline"
            >
              {t('dashboard:tagEmptyMid')}
            </a>
            {t('dashboard:tagEmptyEnd')}
          </p>
        ) : (
          <>
            {/* Bypass toggle — all-or-nothing override */}
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={bypassTagFilter}
                onChange={(e) => setBypassTagFilter(e.target.checked)}
                className="accent-[var(--color-brand)]"
              />
              {t('dashboard:includeExcluded')}
            </label>

            <div className="h-4 w-px bg-[var(--color-border)] mx-1 hidden sm:block" aria-hidden />

            {/* Per-tag toggles (merged by normalized name across family cluster). */}
            <div className="flex flex-wrap gap-1.5">
              {tagDisplayGroups.map((group) => {
                const allDefault = everyMemberDefaultExcluded(group);
                const togglable = togglableTagIds(group);
                const mergedManual = allTogglableManuallyExcluded(group, manualExcludeTagIds);
                const isManuallyExcluded = togglable.length > 0 && mergedManual;
                const effectivelyExcluded =
                  !bypassTagFilter &&
                  group.members.every((m) => m.exclude_from_stats || manualExcludeTagIds.includes(m.id));
                const tooltipParts = group.members.map(
                  (m) => `${m.name} · ${ledgerLabelById[m.ledger_id] ?? m.ledger_id}`,
                );
                const titleBase =
                  group.members.length > 1 ? `${tooltipParts.join('；')}\n` : `${tooltipParts[0] ?? ''}\n`;
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => {
                      if (allDefault) return;
                      toggleMergedManualExclude(group);
                    }}
                    disabled={allDefault}
                    title={
                      allDefault
                        ? t('dashboard:tagTooltipDefault')
                        : isManuallyExcluded
                          ? titleBase + t('dashboard:tagTooltipRestore')
                          : titleBase + t('dashboard:tagTooltipExclude')
                    }
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                      effectivelyExcluded
                        ? 'border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)] line-through'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                      allDefault && 'cursor-not-allowed',
                    )}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: group.members[0]?.color || '#a78bfa' }}
                    />
                    <span>{group.displayName}</span>
                    {group.members.length > 1 && (
                      <span className="text-[9px] opacity-70 tabular-nums">×{group.members.length}</span>
                    )}
                    {allDefault && <span className="opacity-70">{t('dashboard:tagDefaultSuffix')}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Chart + recent transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3" padding="lg">
          <CardHeader
            icon={<PieChartIcon size={16} />}
            title={t('dashboard:chartTitle')}
            description={chartDescription}
          />
          <div className="mt-4">
            <SpendingChart
              data={spendingChartData}
              totalLabel={totalLabel}
              emptyTitle={
                period === 'month'
                  ? t('dashboard:emptyExpenseMonth')
                  : period === 'year'
                    ? t('dashboard:emptyExpenseYear')
                    : t('dashboard:emptyExpenseAll')
              }
              emptyDescription={
                groupBy === 'project'
                  ? t('dashboard:emptyHintProject')
                  : groupBy === 'ledger'
                    ? t('dashboard:emptyHintLedger')
                    : t('dashboard:emptyHintCategory')
              }
              onSliceClick={groupBy === 'category' ? handleCategorySliceClick : undefined}
            />
          </div>
        </Card>

        <Card className="lg:col-span-2" padding="lg">
          <CardHeader
            icon={<Receipt size={16} />}
            title={t('dashboard:recentTitle')}
            description={
              period === 'month'
                ? mergedFamilyRecent
                  ? t('dashboard:recentDescMergedMonth', { month: selectedYearMonth })
                  : t('dashboard:recentDescMonth', { month: selectedYearMonth })
                : mergedFamilyRecent
                  ? t('dashboard:recentDescMerged')
                  : t('dashboard:recentDescDefault')
            }
            action={
              <button
                onClick={() => navigate('/transactions')}
                className="text-xs font-medium text-[var(--color-brand)] hover:underline flex items-center gap-0.5"
              >
                {t('dashboard:viewAll')} <ArrowUpRight size={12} />
              </button>
            }
          />
          <div className="mt-3 -mx-2">
            {recent.length === 0 ? (
              <EmptyState
                icon={<Receipt size={18} />}
                title={t('dashboard:recentEmptyTitle')}
                description={t('dashboard:recentEmptyDesc')}
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {recent.map((tx) => {
                  const cat = categoryMap[tx.category_id];
                  const subName =
                    tx.ledger_id && tx.ledger_id !== currentLedger.id
                      ? ledgers.find((l) => l.id === tx.ledger_id)?.name
                      : null;
                  return (
                    <li
                      key={tx.id}
                      className="flex items-center gap-3 py-2.5 px-2 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                      <CategoryIcon name={cat?.icon} color={cat?.color} size={34} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--color-text)] truncate">
                          {categoryLabel(cat) || t('dashboard:uncategorized')}
                          {subName && (
                            <span className="ml-1.5 text-[10px] text-[var(--color-brand)] font-normal">
                              · {subName}
                            </span>
                          )}
                          {tx.note && <span className="text-[var(--color-text-subtle)] ml-1.5 text-xs">· {tx.note}</span>}
                        </p>
                        <p className="text-[11px] text-[var(--color-text-subtle)] font-tabular mt-0.5">
                          {formatDateShort(tx.date, t)}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-semibold font-tabular shrink-0 ${
                          tx.type === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--color-text)]'
                        }`}
                      >
                        {tx.type === 'income' ? '+' : '-'}¥{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {showBudget && currentLedger && (
        <EditBudgetModal
          open
          ledgerId={currentLedger.id}
          currentBudget={budget}
          yearMonth={
            summary?.current_month ??
            `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
          }
          defaultMonthlyBudget={currentLedger.default_monthly_budget ?? null}
          onClose={() => setShowBudget(false)}
          onSuccess={() => load(currentLedger)}
        />
      )}

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
