import React, { useEffect, useState } from 'react';
import api from '../api/client';
import { Card, CardHeader, Button } from '../components/ui';
import { Shield, ScrollText, Loader2 } from 'lucide-react';

interface AuditItem {
  id: string;
  created_at: string;
  action: string;
  actor_user_id?: string;
  resource_type: string;
  resource_id?: string;
  ip: string;
  metadata: string;
}

export default function Admin() {
  const [regOpen, setRegOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const loadSettings = async () => {
    const res = await api.get('/admin/settings');
    setRegOpen(res.data.registration_open);
  };

  const loadLogs = async (p: number) => {
    const res = await api.get('/admin/audit-logs', { params: { page: p, page_size: 30 } });
    setLogs(res.data.items || []);
    setTotal(res.data.total || 0);
  };

  useEffect(() => {
    let ok = true;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        await loadSettings();
        await loadLogs(1);
      } catch (e: any) {
        if (ok) setErr(e.response?.data?.error || '加载失败');
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await api.put('/admin/settings', { registration_open: regOpen });
      await loadSettings();
    } catch (e: any) {
      setErr(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-[var(--color-text-muted)]">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)] flex items-center gap-2">
          <Shield size={22} className="text-[var(--color-brand)]" />
          系统管理
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">仅管理员可见：注册开关与审计日志</p>
      </div>

      {err && (
        <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
          {err}
        </div>
      )}

      <Card padding="md">
        <CardHeader
          title="公开注册"
          description="关闭后新用户无法自助注册（OIDC 新用户同样受限于「开放注册」策略）"
        />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
            <input
              type="checkbox"
              checked={regOpen}
              onChange={(e) => setRegOpen(e.target.checked)}
              className="rounded border-[var(--color-border)]"
            />
            允许公开注册
          </label>
          <Button size="sm" loading={saving} onClick={save}>
            保存
          </Button>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ScrollText size={16} /> 审计日志
            </span>
          }
          description={`共 ${total} 条`}
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                <th className="py-2 pr-2 font-medium">时间</th>
                <th className="py-2 pr-2 font-medium">动作</th>
                <th className="py-2 pr-2 font-medium">操作者</th>
                <th className="py-2 pr-2 font-medium">资源</th>
                <th className="py-2 pr-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-border)]/60">
                  <td className="py-2 pr-2 whitespace-nowrap text-[var(--color-text-subtle)]">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text)]">{row.action}</td>
                  <td className="py-2 pr-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                    {row.actor_user_id?.slice(0, 8) || '—'}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-muted)]">
                    {row.resource_type}
                    {row.resource_id ? ` / ${row.resource_id.slice(0, 8)}` : ''}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-subtle)]">{row.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <p className="text-xs text-[var(--color-text-subtle)] py-6 text-center">暂无记录</p>}
        </div>
        {total > 30 && (
          <div className="mt-4 flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => {
                const p = page - 1;
                setPage(p);
                loadLogs(p);
              }}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page * 30 >= total}
              onClick={() => {
                const p = page + 1;
                setPage(p);
                loadLogs(p);
              }}
            >
              下一页
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
