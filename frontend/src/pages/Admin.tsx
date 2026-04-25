import React, { useEffect, useState } from 'react';
import api from '../api/client';
import { Card, CardHeader, Button, Input } from '../components/ui';
import { Shield, ScrollText, Loader2, UserPlus, Users, KeyRound } from 'lucide-react';

interface AuditItem {
  id: string;
  created_at: string;
  action: string;
  actor_user_id?: string;
  resource_type: string;
  resource_id?: string;
  ip: string;
  metadata: string;
  /** 后端生成：操作者可读称呼 */
  actor_label?: string;
  /** 后端生成：资源对象可读说明 */
  resource_label?: string;
  /** 后端生成：一句话中文说明 */
  summary?: string;
}

interface ManagedUser {
  id: string;
  username: string;
  nickname: string;
  email?: string;
  role: 'user' | 'admin';
  is_active: boolean;
  created_at: string;
}

export default function Admin() {
  const [regOpen, setRegOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    nickname: '',
    email: '',
    role: 'user',
  });
  const [creatingUser, setCreatingUser] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [userKeyword, setUserKeyword] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);

  const loadSettings = async () => {
    const res = await api.get('/admin/settings');
    setRegOpen(res.data.registration_open);
  };

  const loadLogs = async (p: number) => {
    const res = await api.get('/admin/audit-logs', { params: { page: p, page_size: 30 } });
    setLogs(res.data.items || []);
    setTotal(res.data.total || 0);
  };

  const loadUsers = async (keyword = '') => {
    setLoadingUsers(true);
    try {
      const res = await api.get('/admin/users', { params: keyword ? { q: keyword } : {} });
      setUsers(res.data.items || []);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    let ok = true;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        await loadSettings();
        await loadUsers();
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

  const createUser = async () => {
    if (!newUser.username.trim()) {
      setErr('用户名不能为空');
      return;
    }
    if (newUser.password.length < 6) {
      setErr('密码至少 6 位');
      return;
    }
    setCreatingUser(true);
    setErr('');
    try {
      await api.post('/admin/users', {
        username: newUser.username.trim(),
        password: newUser.password,
        nickname: newUser.nickname.trim(),
        email: newUser.email.trim(),
        role: newUser.role,
      });
      setNewUser({ username: '', password: '', nickname: '', email: '', role: 'user' });
      await loadUsers(userKeyword.trim());
      await loadLogs(1);
      setPage(1);
    } catch (e: any) {
      setErr(e.response?.data?.error || '创建用户失败');
    } finally {
      setCreatingUser(false);
    }
  };

  const resetPassword = async (u: ManagedUser) => {
    const pwd = window.prompt(`为用户 ${u.username} 设置新密码（至少 6 位）`);
    if (!pwd) return;
    if (pwd.length < 6) {
      setErr('新密码至少 6 位');
      return;
    }
    setErr('');
    try {
      await api.put(`/admin/users/${u.id}/password`, { new_password: pwd });
      await loadLogs(1);
      setPage(1);
    } catch (e: any) {
      setErr(e.response?.data?.error || '重置密码失败');
    }
  };

  const toggleUserStatus = async (u: ManagedUser) => {
    setErr('');
    try {
      await api.put(`/admin/users/${u.id}/status`, { is_active: !u.is_active });
      await loadUsers(userKeyword.trim());
      await loadLogs(1);
      setPage(1);
    } catch (e: any) {
      setErr(e.response?.data?.error || '更新用户状态失败');
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
              <Users size={16} /> 用户管理
            </span>
          }
          description="可重置密码、启用/禁用账号"
        />
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-full md:w-64">
            <Input
              label="搜索用户"
              value={userKeyword}
              onChange={(e) => setUserKeyword(e.target.value)}
              placeholder="用户名/昵称/邮箱"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={() => loadUsers(userKeyword.trim())} loading={loadingUsers}>
            查询
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                <th className="py-2 pr-2 font-medium">用户</th>
                <th className="py-2 pr-2 font-medium">角色</th>
                <th className="py-2 pr-2 font-medium">状态</th>
                <th className="py-2 pr-2 font-medium">创建时间</th>
                <th className="py-2 pr-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[var(--color-border)]/60">
                  <td className="py-2 pr-2">
                    <div className="text-[var(--color-text)] font-medium">{u.username}</div>
                    <div className="text-[10px] text-[var(--color-text-subtle)]">
                      {u.nickname || '—'}{u.email ? ` · ${u.email}` : ''}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-muted)]">{u.role === 'admin' ? '管理员' : '普通用户'}</td>
                  <td className="py-2 pr-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${
                        u.is_active
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-rose-500/15 text-rose-500'
                      }`}
                    >
                      {u.is_active ? '启用中' : '已禁用'}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-subtle)] whitespace-nowrap">
                    {new Date(u.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={<KeyRound size={12} />}
                        onClick={() => resetPassword(u)}
                      >
                        重置密码
                      </Button>
                      <Button
                        size="sm"
                        variant={u.is_active ? 'danger' : 'secondary'}
                        onClick={() => toggleUserStatus(u)}
                      >
                        {u.is_active ? '禁用' : '启用'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="text-xs text-[var(--color-text-subtle)] py-6 text-center">暂无用户</p>
          )}
        </div>
      </Card>

      <Card padding="md">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <UserPlus size={16} /> 新增用户
            </span>
          }
          description="管理员可直接创建本地账号（自动创建其个人账本）"
        />
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="用户名"
            value={newUser.username}
            onChange={(e) => setNewUser((v) => ({ ...v, username: e.target.value }))}
            placeholder="例如：alice"
          />
          <Input
            label="密码"
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser((v) => ({ ...v, password: e.target.value }))}
            placeholder="至少 6 位"
          />
          <Input
            label="昵称（可选）"
            value={newUser.nickname}
            onChange={(e) => setNewUser((v) => ({ ...v, nickname: e.target.value }))}
            placeholder="显示名"
          />
          <Input
            label="邮箱（可选）"
            type="email"
            value={newUser.email}
            onChange={(e) => setNewUser((v) => ({ ...v, email: e.target.value }))}
            placeholder="name@example.com"
          />
          <div className="md:col-span-2">
            <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">角色</p>
            <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
              {(['user', 'admin'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setNewUser((v) => ({ ...v, role: r }))}
                  className={`px-3 h-9 text-xs font-medium ${
                    newUser.role === r
                      ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
                  }`}
                >
                  {r === 'admin' ? '管理员' : '普通用户'}
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <Button size="sm" loading={creatingUser} onClick={createUser}>
              创建用户
            </Button>
          </div>
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
                <th className="py-2 pr-2 font-medium w-[11rem]">时间</th>
                <th className="py-2 pr-2 font-medium min-w-[14rem]">说明</th>
                <th className="py-2 pr-2 font-medium">操作者</th>
                <th className="py-2 pr-2 font-medium">对象</th>
                <th className="py-2 pr-2 font-medium">技术标识</th>
                <th className="py-2 pr-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-border)]/60 align-top">
                  <td className="py-2 pr-2 whitespace-nowrap text-[var(--color-text-subtle)]">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text)] text-[13px] leading-snug">
                    {row.summary || row.action}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-muted)] text-[12px]">
                    {row.actor_label || (row.actor_user_id ? `用户（${row.actor_user_id.slice(0, 8)}…）` : '系统')}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-muted)] text-[12px]">{row.resource_label || '—'}</td>
                  <td className="py-2 pr-2 font-mono text-[10px] text-[var(--color-text-subtle)] break-all max-w-[10rem]">
                    {row.action}
                    {row.resource_id ? ` · ${row.resource_id.slice(0, 8)}…` : ''}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-subtle)] whitespace-nowrap">{row.ip || '—'}</td>
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
