import React, { useEffect, useState } from 'react';
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
  Infinity as InfinityIcon,
  Book,
} from 'lucide-react';
import { cn } from '../components/ui';
import api from '../api/client';
import SpendingChart from '../components/SpendingChart';
import EditBudgetModal from '../components/EditBudgetModal';
import { Button, Card, CardHeader, EmptyState, Badge, CategoryIcon } from '../components/ui';
import { useLayout } from '../components/AppLayout';

interface CategoryStat {
  name: string;
  value: number;
  color: string;
}

interface TagRef {
  id: string;
  name: string;
  color: string;
  exclude_from_stats: boolean;
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
}

type Scope = 'current' | 'all';
type GroupBy = 'category' | 'project' | 'ledger';
type Period = 'month' | 'year' | 'all';

interface Category {
  id: string;
  name: string;
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

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return '昨天';
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function Dashboard() {
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

  // Tag filter state. `bypassTagFilter` trumps `manualExcludeTagIds`:
  // when true, the dashboard shows EVERYTHING including tags flagged as
  // "默认排除". Manual tag ids are additive to the defaults.
  const [bypassTagFilter, setBypassTagFilter] = useState(false);
  const [manualExcludeTagIds, setManualExcludeTagIds] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<TagRef[]>([]);

  const categoryMap = React.useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => (map[c.id] = c));
    return map;
  }, [categories]);

  const load = async (ledgerId: string) => {
    try {
      setLoading(true);
      const sumParams = new URLSearchParams({ group_by: groupBy, period });
      if (scope === 'all') {
        sumParams.set('scope', 'all');
      } else {
        sumParams.set('ledger_id', ledgerId);
      }
      if (bypassTagFilter) {
        sumParams.set('bypass_tag_filter', 'true');
      } else if (manualExcludeTagIds.length > 0) {
        sumParams.set('exclude_tag_ids', manualExcludeTagIds.join(','));
      }
      const [sumRes, catRes, txRes, tagRes] = await Promise.all([
        api.get(`/dashboard/summary?${sumParams.toString()}`),
        api.get(`/categories?ledger_id=${ledgerId}`),
        api.get(`/transactions?ledger_id=${ledgerId}&limit=5`),
        api.get(`/tags?ledger_id=${ledgerId}`),
      ]);
      setSummary(sumRes.data);
      setCategories(catRes.data || []);
      const txs = Array.isArray(txRes.data) ? txRes.data : txRes.data?.items || [];
      setRecent(txs.slice(0, 5));
      setAllTags(tagRes.data || []);
    } catch (err) {
      console.error('Failed to load dashboard', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentLedger) load(currentLedger.id);
    const refresh = () => currentLedger && load(currentLedger.id);
    window.addEventListener('sprouts:refresh', refresh);
    return () => window.removeEventListener('sprouts:refresh', refresh);
  }, [currentLedger?.id, scope, groupBy, period, bypassTagFilter, manualExcludeTagIds.join(',')]);

  const toggleManualExcludeTag = (id: string) => {
    setManualExcludeTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  if (!currentLedger) {
    return (
      <Card>
        <EmptyState
          icon={<Wallet size={18} />}
          title="还没有可用账本"
          description="账本可能加载失败，请刷新页面或重新登录"
        />
      </Card>
    );
  }

  if (loading && !summary) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-[var(--color-text-subtle)]">
        <Loader2 className="animate-spin" size={24} />
        <p className="text-xs">正在加载你的账本…</p>
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
        ? `${summary?.year ?? new Date().getFullYear()} 年`
        : '全部时间';
  const expenseLabel = period === 'month' ? '本月支出' : period === 'year' ? '本年支出' : '累计支出';
  const totalLabel = period === 'month' ? '本月支出' : period === 'year' ? '本年支出' : '累计支出';

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-widest">
            {periodLabel} ·{' '}
            {scope === 'all' ? `全部账本 (${summary?.ledger_count ?? 0})` : currentLedger.name}
          </p>
          <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">仪表盘</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl<Period>
            items={[
              { value: 'month', label: '本月', icon: <CalendarDays size={12} /> },
              { value: 'year', label: '本年', icon: <CalendarRange size={12} /> },
              { value: 'all', label: '全部', icon: <InfinityIcon size={12} /> },
            ]}
            value={period}
            onChange={setPeriod}
          />
          <SegmentedControl<Scope>
            items={[
              { value: 'current', label: '当前账本', icon: <Wallet size={12} /> },
              { value: 'all', label: '全部账本', icon: <Layers size={12} /> },
            ]}
            value={scope}
            onChange={(v) => {
              setScope(v);
              if (v === 'current' && groupBy === 'ledger') setGroupBy('category');
            }}
          />
          <SegmentedControl<GroupBy>
            items={[
              { value: 'category', label: '按分类', icon: <Tag size={12} /> },
              { value: 'project', label: '按项目', icon: <FolderKanban size={12} /> },
              ...(scope === 'all'
                ? [{ value: 'ledger' as GroupBy, label: '按账本', icon: <Book size={12} /> }]
                : []),
            ]}
            value={groupBy}
            onChange={setGroupBy}
          />
          {scope === 'current' && period === 'month' && (
            <Button variant="outline" size="sm" leftIcon={<Pencil size={14} />} onClick={() => setShowBudget(true)}>
              编辑预算
            </Button>
          )}
        </div>
      </div>

      {scope === 'current' &&
        currentLedger.type === 'family' &&
        (currentLedger.linked_personal?.length ?? 0) > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60">
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              {summary?.includes_linked_personal ? (
                <>
                  支出与图表已汇总 <span className="font-medium text-[var(--color-text)]">家庭账本 + 您已关联的 {summary.linked_personal_in_cluster} 个个人子账本</span>
                  ；月预算仍仅按家庭账本设定。
                </>
              ) : (
                <>已关联个人子账本；若刚完成关联，请刷新页面以更新汇总。</>
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
                    打开「{sub.name}」
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
                <Wallet size={12} /> 本月剩余预算
              </p>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-semibold font-tabular ${overBudget ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'}`}>
                  ¥{remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {budget > 0 && (
                  <Badge tone={overBudget ? 'danger' : usagePct > 80 ? 'warning' : 'success'}>
                    {overBudget ? '已超支' : `${usagePct.toFixed(0)}% 已用`}
                  </Badge>
                )}
              </div>
            </div>
            {budget === 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowBudget(true)}>
                设定预算
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
              <span>已支出 ¥{expense.toLocaleString()}</span>
              <span>预算 ¥{budget.toLocaleString()}</span>
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
            <div>
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider flex items-center gap-1">
                <Calendar size={11} /> 剩余天数
              </p>
              <p className="text-sm font-semibold font-tabular text-[var(--color-text)] mt-1">{summary?.days_left ?? 0} 天</p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={11} /> 日均可花
              </p>
              <p className={`text-sm font-semibold font-tabular mt-1 ${summary && summary.daily_avg_limit < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-brand)]'}`}>
                ¥{(summary?.daily_avg_limit ?? 0).toFixed(2)}
              </p>
            </div>
          </div>
        </Card>

        {/* Quick stats card */}
        <Card padding="lg" className="flex flex-col justify-between">
          <div>
            <CardHeader
              icon={<TrendingDown size={16} />}
              title="本月动态"
              description="与预算对比的关键信号"
            />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between py-2.5 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
                <span className="text-xs text-[var(--color-text-muted)]">分类数量</span>
                <span className="text-sm font-medium font-tabular">{summary?.category_stats?.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
                <span className="text-xs text-[var(--color-text-muted)]">支出占比</span>
                <span className="text-sm font-medium font-tabular">
                  {budget > 0 ? `${usagePct.toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
                <span className="text-xs text-[var(--color-text-muted)]">健康度</span>
                <Badge tone={overBudget ? 'danger' : usagePct > 80 ? 'warning' : 'success'} dot>
                  {overBudget ? '超支' : usagePct > 80 ? '临界' : '良好'}
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Tag filter (always shown so users can discover and manage
          exclusions, even before any tag exists). */}
      <Card padding="md" className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] shrink-0">
          <Tag size={12} /> 标签筛选
        </div>

        {allTags.length === 0 ? (
          <p className="text-[11px] text-[var(--color-text-subtle)]">
            还没有标签。到「
            <a
              href="/categories"
              onClick={(e) => {
                e.preventDefault();
                navigate('/categories');
              }}
              className="text-[var(--color-brand)] hover:underline"
            >
              分类 → 标签
            </a>
            」创建后，支出分析可按标签排除/包含（例如排除「报销」「转账」不进入统计）。
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
              包含所有已排除标签
            </label>

            <div className="h-4 w-px bg-[var(--color-border)] mx-1" />

            {/* Per-tag toggles: default-excluded tags are disabled (handled by
                bypass switch), the rest can be manually added to the blocklist. */}
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tg) => {
                const isDefaultExcluded = tg.exclude_from_stats;
                const isManuallyExcluded = manualExcludeTagIds.includes(tg.id);
                const effectivelyExcluded = !bypassTagFilter && (isDefaultExcluded || isManuallyExcluded);
                return (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => {
                      if (isDefaultExcluded) return; // governed by bypass
                      toggleManualExcludeTag(tg.id);
                    }}
                    disabled={isDefaultExcluded}
                    title={
                      isDefaultExcluded
                        ? '该标签在「分类 → 标签」里被设为默认排除，使用上方开关统一控制'
                        : isManuallyExcluded
                        ? '点击恢复此标签到统计中'
                        : '点击从统计中排除此标签'
                    }
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                      effectivelyExcluded
                        ? 'border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)] line-through'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                      isDefaultExcluded && 'cursor-not-allowed',
                    )}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tg.color || '#a78bfa' }} />
                    {tg.name}
                    {isDefaultExcluded && <span className="opacity-70">·默认</span>}
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
            title="支出分析"
            description={
              (groupBy === 'category' ? '按分类统计' : groupBy === 'project' ? '按项目统计' : '按账本统计') +
              (period === 'month' ? '本月支出' : period === 'year' ? '本年支出' : '累计支出') +
              (scope === 'all' ? '（跨账本汇总）' : '')
            }
          />
          <div className="mt-4">
            <SpendingChart
              data={
                (groupBy === 'category'
                  ? summary?.category_stats
                  : groupBy === 'project'
                    ? summary?.project_stats
                    : summary?.ledger_stats) || []
              }
              totalLabel={totalLabel}
              emptyTitle={
                period === 'month' ? '本月还没有支出' : period === 'year' ? '本年还没有支出' : '暂无支出记录'
              }
              emptyDescription={
                groupBy === 'project'
                  ? '将交易关联到项目即可在此查看占比'
                  : groupBy === 'ledger'
                    ? '切换到「全部账本」并添加多本账本后，这里会展示各账本占比'
                    : '记录第一笔开销后，这里会展示分类占比'
              }
            />
          </div>
        </Card>

        <Card className="lg:col-span-2" padding="lg">
          <CardHeader
            icon={<Receipt size={16} />}
            title="最近流水"
            description="最新的 5 条记录"
            action={
              <button
                onClick={() => navigate('/transactions')}
                className="text-xs font-medium text-[var(--color-brand)] hover:underline flex items-center gap-0.5"
              >
                查看全部 <ArrowUpRight size={12} />
              </button>
            }
          />
          <div className="mt-3 -mx-2">
            {recent.length === 0 ? (
              <EmptyState
                icon={<Receipt size={18} />}
                title="暂无记录"
                description="点击右上角「记一笔」开始记录"
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {recent.map((tx) => {
                  const cat = categoryMap[tx.category_id];
                  return (
                    <li
                      key={tx.id}
                      className="flex items-center gap-3 py-2.5 px-2 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                      <CategoryIcon name={cat?.icon} color={cat?.color} size={34} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--color-text)] truncate">
                          {cat?.name || '未分类'}
                          {tx.note && <span className="text-[var(--color-text-subtle)] ml-1.5 text-xs">· {tx.note}</span>}
                        </p>
                        <p className="text-[11px] text-[var(--color-text-subtle)] font-tabular mt-0.5">
                          {formatDateShort(tx.date)}
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
          onClose={() => setShowBudget(false)}
          onSuccess={() => load(currentLedger.id)}
        />
      )}
    </div>
  );
}
