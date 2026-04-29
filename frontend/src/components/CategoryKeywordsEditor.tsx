import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Loader2 } from 'lucide-react';
import api from '../api/client';
import { cn } from './ui';

export interface CategoryKeyword {
  id: string;
  keyword_zh?: string;
  keyword_en?: string;
  /** Server-built display; fallback to zh / en if missing */
  keyword?: string;
}

function displayKeyword(k: CategoryKeyword): string {
  if (k.keyword && k.keyword.trim()) return k.keyword;
  const a = (k.keyword_zh || '').trim();
  const b = (k.keyword_en || '').trim();
  if (a && b) return `${a} / ${b}`;
  return a || b;
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

interface Props {
  categoryId: string;
  keywords: CategoryKeyword[];
  onChange: (next: CategoryKeyword[]) => void;
  compact?: boolean;
}

// CategoryKeywordsEditor: bilingual quick-record keywords (Telegram / one-line).
// At least one of 中文 / English must be filled when adding.
export default function CategoryKeywordsEditor({ categoryId, keywords, onChange, compact }: Props) {
  const { t } = useTranslation('categories');
  const [draftZh, setDraftZh] = useState('');
  const [draftEn, setDraftEn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addKeyword = async () => {
    const zh = draftZh.trim();
    const en = draftEn.trim();
    if (!zh && !en) return;

    const clash = keywords.some((k) => {
      const kz = norm(k.keyword_zh || '');
      const ke = norm(k.keyword_en || '');
      if (zh && (kz === norm(zh) || ke === norm(zh))) return true;
      if (en && (ke === norm(en) || kz === norm(en))) return true;
      return false;
    });
    if (clash) {
      setError(t('kwDuplicate'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const body: { keyword_zh?: string; keyword_en?: string } = {};
      if (zh) body.keyword_zh = zh;
      if (en) body.keyword_en = en;
      const res = await api.post(`/categories/${categoryId}/keywords`, body);
      onChange([
        ...keywords,
        {
          id: res.data.id,
          keyword_zh: res.data.keyword_zh ?? '',
          keyword_en: res.data.keyword_en ?? '',
          keyword: typeof res.data.keyword === 'string' ? res.data.keyword : undefined,
        },
      ]);
      setDraftZh('');
      setDraftEn('');
    } catch (err: any) {
      const serverMsg = err.response?.data?.error;
      const existing = err.response?.data?.existing_category;
      if (existing) {
        setError(t('kwAssigned', { name: existing }));
      } else {
        setError(serverMsg || t('kwAddFailed'));
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
      setError(err.response?.data?.error || t('kwDeleteFailed'));
    }
  };

  return (
    <div className={cn('space-y-2', compact ? 'mt-1' : 'mt-2')}>
      <p className="text-[10px] text-[var(--color-text-subtle)] leading-snug">{t('kwBilingualHint')}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {keywords.map((kw) => {
          const label = displayKeyword(kw);
          return (
            <span
              key={kw.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
            >
              {label}
              <button
                type="button"
                onClick={() => removeKeyword(kw.id)}
                className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
                aria-label={t('kwDeleteAria', { keyword: label })}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        <div className="inline-flex flex-wrap items-center gap-1">
          <input
            value={draftZh}
            onChange={(e) => {
              setDraftZh(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder={t('kwZhPlaceholder')}
            className="h-6 px-2 text-[11px] rounded-full border border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:border-[var(--color-brand)] w-[5.5rem]"
          />
          <span className="text-[10px] text-[var(--color-text-subtle)]">/</span>
          <input
            value={draftEn}
            onChange={(e) => {
              setDraftEn(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder={t('kwEnPlaceholder')}
            className="h-6 px-2 text-[11px] rounded-full border border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:border-[var(--color-brand)] w-[5.5rem]"
          />
          {(draftZh.trim() || draftEn.trim()) && (
            <button
              type="button"
              disabled={saving}
              onClick={addKeyword}
              className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-[var(--color-brand)] text-white hover:opacity-90 disabled:opacity-60"
              aria-label={t('kwAddAria')}
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
