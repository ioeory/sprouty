import React, { useState } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';
import api from '../api/client';
import { cn } from './ui';

export interface CategoryKeyword {
  id: string;
  keyword: string;
}

interface Props {
  categoryId: string;
  keywords: CategoryKeyword[];
  onChange: (next: CategoryKeyword[]) => void;
  compact?: boolean;
}

// CategoryKeywordsEditor renders a chip list for a single category's quick-record
// keywords with an inline add-input. It mutates the parent list via `onChange`
// so the parent keeps one source of truth for the category's keywords.
export default function CategoryKeywordsEditor({ categoryId, keywords, onChange, compact }: Props) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addKeyword = async () => {
    const value = draft.trim();
    if (!value) return;
    // Client-side dup check to avoid a round-trip for the obvious case
    if (keywords.some((k) => k.keyword.toLowerCase() === value.toLowerCase())) {
      setError('关键字已存在');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.post(`/categories/${categoryId}/keywords`, { keyword: value });
      onChange([...keywords, { id: res.data.id, keyword: res.data.keyword }]);
      setDraft('');
    } catch (err: any) {
      const serverMsg = err.response?.data?.error;
      const existing = err.response?.data?.existing_category;
      if (existing) {
        setError(`该关键字已分配给「${existing}」`);
      } else {
        setError(serverMsg || '添加失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const removeKeyword = async (kwId: string) => {
    try {
      await api.delete(`/category-keywords/${kwId}`);
      onChange(keywords.filter((k) => k.id !== kwId));
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    }
  };

  return (
    <div className={cn('space-y-2', compact ? 'mt-1' : 'mt-2')}>
      <div className="flex flex-wrap items-center gap-1.5">
        {keywords.map((kw) => (
          <span
            key={kw.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
          >
            {kw.keyword}
            <button
              type="button"
              onClick={() => removeKeyword(kw.id)}
              className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
              aria-label={`删除关键字 ${kw.keyword}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <div className="inline-flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder="加关键字…"
            className="h-6 px-2 text-[11px] rounded-full border border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:border-[var(--color-brand)] w-24"
          />
          {draft && (
            <button
              type="button"
              disabled={saving}
              onClick={addKeyword}
              className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-[var(--color-brand)] text-white hover:opacity-90 disabled:opacity-60"
              aria-label="添加关键字"
            >
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-[10px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
