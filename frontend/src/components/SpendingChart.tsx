import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { PieChart as PieIcon } from 'lucide-react';
import { EmptyState, cn } from './ui';

export interface PieDatum {
  name: string;
  value: number;
  color: string;
  /** Present for dashboard category slices — stable list keys */
  category_id?: string;
  /** All physical category UUIDs when slices are merged by semantics */
  category_ids?: string[];
  name_zh?: string;
  name_en?: string;
  /** When set, tooltip shows this as a second line (e.g. merged category names) */
  detail?: string;
}

interface Props {
  data: PieDatum[];
  totalLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /** When set, pie segments and legend rows become clickable (e.g. category drill-down). */
  onSliceClick?: (row: PieDatum) => void;
}

export const PIE_OTHER_CATEGORY_ID = '__pie_other__';
const OTHER_ID = PIE_OTHER_CATEGORY_ID;
const OTHER_COLOR = '#64748b';

/** Shares below this fraction of total are merged into one「其他」slice so the ring stays readable. */
const MIN_SHARE_FOR_OWN_SLICE = 0.015;

/**
 * Merge many hairline slices into a single「其他」row; keeps items above MIN_SHARE_FOR_OWN_SLICE separate.
 */
function aggregateSmallSlices(rows: PieDatum[], otherLabel: string): PieDatum[] {
  const total = rows.reduce((s, d) => s + d.value, 0);
  if (total <= 0 || rows.length === 0) return rows;

  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const main: PieDatum[] = [];
  let otherSum = 0;
  const otherNames: string[] = [];
  const otherCategoryIds = new Set<string>();

  const collectIds = (d: PieDatum) => {
    if (d.category_ids?.length) {
      d.category_ids.forEach((id) => otherCategoryIds.add(id));
    } else if (d.category_id && d.category_id !== OTHER_ID) {
      otherCategoryIds.add(d.category_id);
    }
  };

  for (const d of sorted) {
    const share = d.value / total;
    if (share >= MIN_SHARE_FOR_OWN_SLICE) {
      main.push(d);
    } else {
      otherSum += d.value;
      collectIds(d);
      if (otherNames.length < 8) otherNames.push(d.name);
    }
  }

  if (otherSum > 0) {
    const detail =
      otherNames.length > 0
        ? otherNames.join('、') + (sorted.filter((d) => d.value / total < MIN_SHARE_FOR_OWN_SLICE).length > otherNames.length ? '…' : '')
        : undefined;
    const mergedOtherIds = otherCategoryIds.size > 0 ? [...otherCategoryIds] : undefined;
    main.push({
      name: otherLabel,
      value: otherSum,
      color: OTHER_COLOR,
      category_id: OTHER_ID,
      category_ids: mergedOtherIds,
      detail,
    });
  }

  // All slices were tiny: one combined「其他」covering 100% (still clearer than many invisible arcs)
  if (main.length === 0 && sorted.length > 0) {
    const names = sorted.slice(0, 10).map((d) => d.name);
    const detailStr = names.join('、') + (sorted.length > 10 ? '…' : '');
    sorted.forEach(collectIds);
    return [
      {
        name: otherLabel,
        value: total,
        color: OTHER_COLOR,
        category_id: OTHER_ID,
        category_ids: otherCategoryIds.size > 0 ? [...otherCategoryIds] : undefined,
        detail: detailStr,
      },
    ];
  }

  return main.sort((a, b) => {
    if (a.category_id === OTHER_ID) return 1;
    if (b.category_id === OTHER_ID) return -1;
    return b.value - a.value;
  });
}

export default function SpendingChart({
  data,
  totalLabel,
  emptyTitle,
  emptyDescription,
  onSliceClick,
}: Props) {
  const { t } = useTranslation('dashboard');
  const resolvedTotal = totalLabel ?? t('spendChartTotal');
  const resolvedEmptyTitle = emptyTitle ?? t('spendChartEmptyTitle');
  const resolvedEmptyDesc = emptyDescription ?? t('spendChartEmptyDesc');

  const chartData = useMemo(
    () => aggregateSmallSlices(data, t('chartOther')),
    [data, t],
  );

  if (!data || data.length === 0) {
    return (
      <EmptyState icon={<PieIcon size={18} />} title={resolvedEmptyTitle} description={resolvedEmptyDesc} />
    );
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  const n = chartData.length;
  const paddingAngle = n <= 4 ? 1.2 : n <= 8 ? 0.6 : 0.25;
  const strokeW = n > 10 ? 1 : 2;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
      <div className="relative h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={78}
              paddingAngle={paddingAngle}
              dataKey="value"
              animationDuration={600}
              stroke="var(--color-surface)"
              strokeWidth={strokeW}
              style={{ cursor: onSliceClick ? 'pointer' : undefined }}
              onClick={
                onSliceClick
                  ? (sector: PieDatum & { payload?: PieDatum }, _index: number) => {
                      const row = (sector.payload ?? sector) as PieDatum;
                      if (row?.value != null) onSliceClick(row);
                    }
                  : undefined
              }
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={entry.category_id || `cell-${index}`}
                  fill={entry.color || '#a1a1aa'}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as PieDatum;
                const v = row?.value ?? payload[0].value;
                return (
                  <div
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] shadow-md max-w-[280px]"
                    style={{ boxShadow: 'var(--shadow-md)' }}
                  >
                    <div className="font-medium">
                      {row?.name}: ¥{Number(v).toLocaleString()}
                    </div>
                    {row?.detail ? (
                      <div className="mt-1 text-[11px] leading-snug text-[var(--color-text-muted)]">{row.detail}</div>
                    ) : null}
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-subtle)]">{resolvedTotal}</p>
          <p className="text-lg font-semibold font-tabular text-[var(--color-text)]">¥{total.toLocaleString()}</p>
        </div>
      </div>

      <ul className="space-y-2 max-h-52 overflow-y-auto pr-1">
        {chartData.map((d, index) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          const legendKey =
            (d.category_ids?.length ? d.category_ids.join('-') : d.category_id) ||
            `legend-${index}-${d.name}`;
          return (
            <li
              key={legendKey}
              className={cn(
                'flex items-center gap-3',
                onSliceClick && d.category_id !== OTHER_ID && 'cursor-pointer hover:opacity-90',
              )}
              onClick={() => {
                if (onSliceClick && d.category_id !== OTHER_ID) onSliceClick(d);
              }}
              role={onSliceClick && d.category_id !== OTHER_ID ? 'button' : undefined}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: d.color || '#a1a1aa' }}
              />
              <span className="flex-1 text-xs text-[var(--color-text)] truncate" title={d.detail}>
                {d.name}
              </span>
              <span className="text-xs font-medium font-tabular text-[var(--color-text-muted)] tabular-nums">
                {pct.toFixed(1)}%
              </span>
              <span className="text-xs font-tabular text-[var(--color-text-subtle)] w-20 text-right">
                ¥{d.value.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
