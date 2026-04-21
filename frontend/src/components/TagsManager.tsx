import { useEffect, useState } from 'react';
import { Plus, Trash2, Tag as TagIcon, Loader2, EyeOff, Eye } from 'lucide-react';
import api from '../api/client';
import { Button, Card, CardHeader, Input, Badge, cn } from './ui';

export interface Tag {
  id: string;
  ledger_id: string;
  name: string;
  color: string;
  exclude_from_stats: boolean;
}

interface Props {
  ledgerId: string;
}

// Palette intentionally pastel-first so tag chips stay visually quiet next to
// categories (which are the primary taxonomy). Keep count odd so the grid
// doesn't collapse to a full row.
const TAG_PALETTE = [
  '#a78bfa', '#f472b6', '#fb7185', '#fbbf24', '#84cc16',
  '#22d3ee', '#60a5fa', '#94a3b8', '#f97316',
];

export default function TagsManager({ ledgerId }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_PALETTE[0]);
  const [newExclude, setNewExclude] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/tags?ledger_id=${ledgerId}`);
      setTags(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ledgerId) load();
  }, [ledgerId]);

  const add = async () => {
    const name = newName.trim();
    if (!name) {
      setError('请输入标签名');
      return;
    }
    // Client-side dup guard so common mistakes don't even round-trip.
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setError('该标签已存在');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const res = await api.post('/tags', {
        ledger_id: ledgerId,
        name,
        color: newColor,
        exclude_from_stats: newExclude,
      });
      setTags([...tags, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewExclude(false);
    } catch (err: any) {
      setError(err.response?.data?.error || '添加失败');
    } finally {
      setAdding(false);
    }
  };

  const toggleExclude = async (tag: Tag) => {
    try {
      const res = await api.put(`/tags/${tag.id}`, { exclude_from_stats: !tag.exclude_from_stats });
      setTags(tags.map((t) => (t.id === tag.id ? res.data : t)));
    } catch (err) {
      console.error(err);
    }
  };

  const changeColor = async (tag: Tag, color: string) => {
    try {
      const res = await api.put(`/tags/${tag.id}`, { color });
      setTags(tags.map((t) => (t.id === tag.id ? res.data : t)));
    } catch (err) {
      console.error(err);
    }
  };

  const remove = async (tag: Tag) => {
    if (!confirm(`删除标签「${tag.name}」？这也会移除其与记录的关联。`)) return;
    try {
      await api.delete(`/tags/${tag.id}`);
      setTags(tags.filter((t) => t.id !== tag.id));
    } catch (err: any) {
      alert(err.response?.data?.error || '删除失败');
    }
  };

  return (
    <Card padding="lg">
      <CardHeader
        icon={<TagIcon size={16} />}
        title={
          <span className="flex items-center gap-2">
            标签
            <Badge tone="info">{tags.length}</Badge>
          </span>
        }
      />
      <p className="text-[11px] text-[var(--color-text-subtle)] mt-1">
        给一笔消费打标签（如 报销、转账、家庭），打开「默认排除」后支出分析会忽略它。
        Telegram 里可在消息末尾用 <code>l:报销</code> 或 <code>标签:公账</code> 打标签。
      </p>

      {/* Add row */}
      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <Input
              label="新标签"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：报销、转账、家庭"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !adding) add();
              }}
            />
          </div>
          <div>
            <p className="text-[11px] font-medium text-[var(--color-text-muted)] mb-1.5">颜色</p>
            <div className="flex gap-1">
              {TAG_PALETTE.slice(0, 6).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={cn(
                    'w-6 h-6 rounded-full border transition-all',
                    newColor === c
                      ? 'border-[var(--color-text)] scale-110 shadow-xs'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] mb-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newExclude}
              onChange={(e) => setNewExclude(e.target.checked)}
              className="accent-[var(--color-brand)]"
            />
            默认排除
          </label>
          <Button
            size="sm"
            leftIcon={<Plus size={12} />}
            onClick={add}
            loading={adding}
            className="mb-1"
          >
            添加
          </Button>
        </div>
        {error && (
          <div className="text-[11px] text-[var(--color-danger)]">{error}</div>
        )}
      </div>

      {/* List */}
      <div className="mt-5">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-[var(--color-text-subtle)]">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : tags.length === 0 ? (
          <p className="text-xs text-[var(--color-text-subtle)] py-6 text-center">
            还没有标签。添加一个试试，比如「报销」或「转账」。
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className={cn(
                  'group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border transition-colors',
                  tag.exclude_from_stats
                    ? 'border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]',
                )}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full relative"
                  style={{ backgroundColor: tag.color }}
                  title="点击换色"
                  onClick={() => {
                    // Cycle to the next palette color for quick edits without a modal.
                    const idx = TAG_PALETTE.indexOf(tag.color);
                    const next = TAG_PALETTE[(idx + 1) % TAG_PALETTE.length];
                    changeColor(tag, next);
                  }}
                  role="button"
                />
                <span className="text-xs">{tag.name}</span>
                <button
                  onClick={() => toggleExclude(tag)}
                  title={tag.exclude_from_stats ? '当前默认排除，点击恢复统计' : '默认统计中，点击设为排除'}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] transition-colors"
                >
                  {tag.exclude_from_stats ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  onClick={() => remove(tag)}
                  title="删除标签"
                  className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
