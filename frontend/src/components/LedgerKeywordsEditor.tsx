import React, { useEffect, useState } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';
import api from '../api/client';

export interface LedgerKeyword {
  id: string;
  keyword: string;
}

interface Props {
  ledgerId: string;
  // Optional initial keywords if the caller already has them (e.g. from GetLedgers).
  // The component still fetches on mount to stay in sync across sessions.
  initial?: LedgerKeyword[];
}

// LedgerKeywordsEditor owns its own keyword list (unlike CategoryKeywordsEditor
// which defers to the parent) because the Members page doesn't pre-fetch
// keywords per-ledger. We refresh when `ledgerId` changes.
export default function LedgerKeywordsEditor({ ledgerId, initial }: Props) {
  const [keywords, setKeywords] = useState<LedgerKeyword[]>(initial || []);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/ledgers/${id}/keywords`);
      setKeywords((res.data || []).map((k: any) => ({ id: k.id, keyword: k.keyword })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ledgerId) load(ledgerId);
  }, [ledgerId]);

  const addKeyword = async () => {
    const value = draft.trim();
    if (!value) return;
    if (keywords.some((k) => k.keyword.toLowerCase() === value.toLowerCase())) {
      setError('关键字已存在');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.post(`/ledgers/${ledgerId}/keywords`, { keyword: value });
      setKeywords((prev) => [...prev, { id: res.data.id, keyword: res.data.keyword }]);
      setDraft('');
    } catch (err: any) {
      const serverMsg = err.response?.data?.error;
      const existing = err.response?.data?.existing_ledger;
      if (existing) {
        setError(`该关键字已指向「${existing}」账本`);
      } else {
        setError(serverMsg || '添加失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const removeKeyword = async (id: string) => {
    try {
      await api.delete(`/ledger-keywords/${id}`);
      setKeywords((prev) => prev.filter((k) => k.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {loading && <Loader2 className="animate-spin text-[var(--color-text-subtle)]" size={14} />}
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
            className="h-7 px-2 text-xs rounded-full border border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:border-[var(--color-brand)] w-28"
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
      {error && <p className="text-[11px] text-[var(--color-danger)]">{error}</p>}
      <p className="text-[11px] text-[var(--color-text-subtle)] leading-relaxed">
        在消息中写入任意一个关键字，即可把记账写入当前账本。关键字在你的所有账本之间唯一。
      </p>
    </div>
  );
}
