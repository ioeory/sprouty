import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { PieChart as PieIcon } from 'lucide-react';
import { EmptyState } from './ui';

interface PieDatum {
  name: string;
  value: number;
  color: string;
}

interface Props {
  data: PieDatum[];
  totalLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export default function SpendingChart({
  data,
  totalLabel = '本月总支出',
  emptyTitle = '本月还没有支出',
  emptyDescription = '记录第一笔开销，这里会展示分类占比',
}: Props) {
  if (!data || data.length === 0) {
    return <EmptyState icon={<PieIcon size={18} />} title={emptyTitle} description={emptyDescription} />;
  }

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
      <div className="relative h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={78}
              paddingAngle={2}
              dataKey="value"
              animationDuration={600}
              stroke="var(--color-surface)"
              strokeWidth={2}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color || '#a1a1aa'} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
                boxShadow: 'var(--shadow-md)',
                padding: '6px 10px',
                color: 'var(--color-text)',
              }}
              itemStyle={{ color: 'var(--color-text)' }}
              formatter={(value: number, _: string, payload: any) => [
                `¥${value.toLocaleString()}`,
                payload?.payload?.name,
              ]}
              labelFormatter={() => ''}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-subtle)]">{totalLabel}</p>
          <p className="text-lg font-semibold font-tabular text-[var(--color-text)]">¥{total.toLocaleString()}</p>
        </div>
      </div>

      <ul className="space-y-2">
        {data
          .slice()
          .sort((a, b) => b.value - a.value)
          .slice(0, 6)
          .map((d) => {
            const pct = total > 0 ? (d.value / total) * 100 : 0;
            return (
              <li key={d.name} className="flex items-center gap-3">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: d.color || '#a1a1aa' }}
                />
                <span className="flex-1 text-xs text-[var(--color-text)] truncate">{d.name}</span>
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
