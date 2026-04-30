import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Tag as TagIcon, Loader2, EyeOff, Eye } from 'lucide-react';
import api from '../api/client';
import { Button, Card, CardHeader, Input, Badge, cn } from './ui';
import { mergeTagsByNormalizedName, normalizeTagName } from '../lib/mergeClusterTags';

export interface Tag {
  id: string;
  ledger_id: string;
  name: string;
  color: string;
  exclude_from_stats: boolean;
}

interface Props {
  ledgerId: string;
  /** When set (e.g. family + linked personals), load tags from all ids and show merged names with ledger hint. */
  clusterLedgerIds?: string[];
  ledgerLabelById?: Record<string, string>;
}

// Palette intentionally pastel-first so tag chips stay visually quiet next to
// categories (which are the primary taxonomy). Keep count odd so the grid
// doesn't collapse to a full row.
const TAG_PALETTE = [
  '#a78bfa', '#f472b6', '#fb7185', '#fbbf24', '#84cc16',
  '#22d3ee', '#60a5fa', '#94a3b8', '#f97316',
];

export default function TagsManager({ ledgerId, clusterLedgerIds, ledgerLabelById }: Props) {
  const { t } = useTranslation('categories');
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_PALETTE[0]);
  const [newExclude, setNewExclude] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const cluster = useMemo(() => {
    if (clusterLedgerIds && clusterLedgerIds.length > 1) return clusterLedgerIds;
    return null;
  }, [clusterLedgerIds]);

  const load = async () => {
    setLoading(true);
    try {
      if (cluster && cluster.length > 0) {
        const results = await Promise.all(cluster.map((id) => api.get(`/tags?ledger_id=${id}`)));
        const flat: Tag[] = [];
        cluster.forEach((id, i) => {
          for (const row of results[i]?.data || []) {
            flat.push({ ...(row as Tag), ledger_id: id });
          }
        });
        setTags(flat);
      } else {
        const res = await api.get(`/tags?ledger_id=${ledgerId}`);
        const rows = (res.data || []) as Tag[];
        setTags(rows.map((r) => ({ ...r, ledger_id: r.ledger_id || ledgerId })));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ledgerId) load();
  }, [ledgerId, cluster?.join(',')]);

  const label = (lid: string) => ledgerLabelById?.[lid] || lid.slice(0, 8);

  /** Expand merged groups to rows: multi-ledger same name → one row per physical tag, sorted. */
  const displayRows = useMemo(() => {
    if (!cluster || cluster.length <= 1) {
      return tags.map((tag) => ({ tag, suffix: '' as string }));
    }
    const groups = mergeTagsByNormalizedName(
      tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        exclude_from_stats: t.exclude_from_stats,
        ledger_id: t.ledger_id,
      })),
    );
    const rows: { tag: Tag; suffix: string }[] = [];
    for (const g of groups) {
      if (g.members.length <= 1) {
        const m = g.members[0];
        const tag = tags.find((x) => x.id === m.id)!;
        rows.push({ tag, suffix: label(tag.ledger_id) !== label(ledgerId) ? ` · ${label(tag.ledger_id)}` : '' });
        continue;
      }
      for (const m of g.members) {
        const tag = tags.find((x) => x.id === m.id)!;
        rows.push({ tag, suffix: ` · ${label(tag.ledger_id)}` });
      }
      seenNorm.add(g.key);
    }
    rows.sort((a, b) => {
      const na = normalizeTagName(a.tag.name);
      const nb = normalizeTagName(b.tag.name);
      if (na !== nb) return na.localeCompare(nb);
      return a.tag.name.localeCompare(b.tag.name) || a.tag.ledger_id.localeCompare(b.tag.ledger_id);
    });
    return rows;
  }, [tags, cluster, ledgerId, ledgerLabelById]);

  const add = async () => {
    const name = newName.trim();
    if (!name) {
      setError(t('tagsNameRequired'));
      return;
    }
    // Client-side dup guard so common mistakes don't even round-trip.
    const dupScope = cluster && cluster.length > 1 ? tags.filter((tag) => tag.ledger_id === ledgerId) : tags;
    if (dupScope.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      setError(t('tagsDuplicate'));
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
      const created = { ...res.data, ledger_id: (res.data as Tag).ledger_id || ledgerId } as Tag;
      setTags([...tags, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewExclude(false);
    } catch (err: any) {
      setError(err.response?.data?.error || t('tagsAddFailed'));
    } finally {
      setAdding(false);
    }
  };

  const toggleExclude = async (tag: Tag) => {
    try {
      const res = await api.put(`/tags/${tag.id}`, { exclude_from_stats: !tag.exclude_from_stats });
      setTags(tags.map((x) => (x.id === tag.id ? res.data : x)));
    } catch (err) {
      console.error(err);
    }
  };

  const changeColor = async (tag: Tag, color: string) => {
    try {
      const res = await api.put(`/tags/${tag.id}`, { color });
      setTags(tags.map((x) => (x.id === tag.id ? res.data : x)));
    } catch (err) {
      console.error(err);
    }
  };

  const remove = async (tag: Tag) => {
    if (!confirm(t('tagsDeleteConfirm', { name: tag.name }))) return;
    try {
      await api.delete(`/tags/${tag.id}`);
      setTags(tags.filter((x) => x.id !== tag.id));
    } catch (err: any) {
      alert(err.response?.data?.error || t('tagsDeleteFailed'));
    }
  };

  return (
    <Card padding="lg">
      <CardHeader
        icon={<TagIcon size={16} />}
        title={
          <span className="flex items-center gap-2">
            {t('tagsTitle')}
            <Badge tone="info">{tags.length}</Badge>
          </span>
        }
      />
      <p className="text-[11px] text-[var(--color-text-subtle)] mt-1">{t('tagsDesc')}</p>

      {/* Add row */}
      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <Input
              label={t('tagsNewLabel')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('tagsPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !adding) add();
              }}
            />
          </div>
          <div>
            <p className="text-[11px] font-medium text-[var(--color-text-muted)] mb-1.5">{t('tagsColor')}</p>
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
            {t('tagsExcludeDefault')}
          </label>
          <Button
            size="sm"
            leftIcon={<Plus size={12} />}
            onClick={add}
            loading={adding}
            className="mb-1"
          >
            {t('tagsAdd')}
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
            {t('tagsEmpty')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {displayRows.map(({ tag, suffix }) => (
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
                  title={t('tagsChangeColor')}
                  onClick={() => {
                    // Cycle to the next palette color for quick edits without a modal.
                    const idx = TAG_PALETTE.indexOf(tag.color);
                    const next = TAG_PALETTE[(idx + 1) % TAG_PALETTE.length];
                    changeColor(tag, next);
                  }}
                  role="button"
                />
                <span className="text-xs">
                  {tag.name}
                  {suffix && <span className="text-[var(--color-text-subtle)] opacity-80">{suffix}</span>}
                </span>
                <button
                  onClick={() => toggleExclude(tag)}
                  title={tag.exclude_from_stats ? t('tagsToggleExcludeOn') : t('tagsToggleExcludeOff')}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] transition-colors"
                >
                  {tag.exclude_from_stats ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  onClick={() => remove(tag)}
                  title={t('tagsDeleteTitle')}
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
