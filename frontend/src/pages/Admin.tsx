import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/client';
import { Card, CardHeader, Button, Input, Modal } from '../components/ui';
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
  const { t } = useTranslation('admin');
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
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetPwd2, setResetPwd2] = useState('');
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetAck, setResetAck] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetModalErr, setResetModalErr] = useState('');

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
        if (ok) setErr(e.response?.data?.error || t('loadFailed'));
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
      setErr(e.response?.data?.error || t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const createUser = async () => {
    if (!newUser.username.trim()) {
      setErr(t('usernameRequired'));
      return;
    }
    if (newUser.password.length < 6) {
      setErr(t('passwordMin'));
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
      setErr(e.response?.data?.error || t('createUserFailed'));
    } finally {
      setCreatingUser(false);
    }
  };

  const openResetPasswordModal = (u: ManagedUser) => {
    setResetModalErr('');
    setResetPwd('');
    setResetPwd2('');
    setResetPhrase('');
    setResetAck(false);
    setResetUser(u);
  };

  const closeResetPasswordModal = () => {
    if (resetSubmitting) return;
    setResetUser(null);
  };

  const submitResetPassword = async () => {
    if (!resetUser) return;
    setResetModalErr('');
    if (resetPwd.length < 6) {
      setResetModalErr(t('newPasswordMin'));
      return;
    }
    if (resetPwd !== resetPwd2) {
      setResetModalErr(t('resetPwdMismatch'));
      return;
    }
    if (resetPhrase.trim() !== resetUser.username) {
      setResetModalErr(t('resetPwdUsernameMismatch'));
      return;
    }
    if (!resetAck) {
      setResetModalErr(t('resetPwdMustAck'));
      return;
    }
    setResetSubmitting(true);
    setErr('');
    try {
      await api.put(`/admin/users/${resetUser.id}/password`, { new_password: resetPwd });
      setResetUser(null);
      await loadLogs(1);
      setPage(1);
    } catch (e: any) {
      setResetModalErr(e.response?.data?.error || t('resetPwdFailed'));
    } finally {
      setResetSubmitting(false);
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
      setErr(e.response?.data?.error || t('statusUpdateFailed'));
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
          {t('title')}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('subtitle')}</p>
      </div>

      {err && (
        <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
          {err}
        </div>
      )}

      <Card padding="md">
        <CardHeader title={t('regTitle')} description={t('regDesc')} />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
            <input
              type="checkbox"
              checked={regOpen}
              onChange={(e) => setRegOpen(e.target.checked)}
              className="rounded border-[var(--color-border)]"
            />
            {t('allowReg')}
          </label>
          <Button size="sm" loading={saving} onClick={save}>
            {t('save')}
          </Button>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Users size={16} /> {t('usersTitle')}
            </span>
          }
          description={t('usersDesc')}
        />
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-full md:w-64">
            <Input
              label={t('searchLabel')}
              value={userKeyword}
              onChange={(e) => setUserKeyword(e.target.value)}
              placeholder={t('searchPh')}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={() => loadUsers(userKeyword.trim())} loading={loadingUsers}>
            {t('query')}
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                <th className="py-2 pr-2 font-medium">{t('colUser')}</th>
                <th className="py-2 pr-2 font-medium">{t('colRole')}</th>
                <th className="py-2 pr-2 font-medium">{t('colStatus')}</th>
                <th className="py-2 pr-2 font-medium">{t('colCreated')}</th>
                <th className="py-2 pr-2 font-medium">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[var(--color-border)]/60">
                  <td className="py-2 pr-2">
                    <div className="text-[var(--color-text)] font-medium">{u.username}</div>
                    <div className="text-[10px] text-[var(--color-text-subtle)]">
                      {u.nickname || t('dash')}
                      {u.email ? ` · ${u.email}` : ''}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-muted)]">
                    {u.role === 'admin' ? t('roleAdmin') : t('roleUser')}
                  </td>
                  <td className="py-2 pr-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${
                        u.is_active
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-rose-500/15 text-rose-500'
                      }`}
                    >
                      {u.is_active ? t('statusActive') : t('statusDisabled')}
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
                        onClick={() => openResetPasswordModal(u)}
                      >
                        {t('resetPwd')}
                      </Button>
                      <Button
                        size="sm"
                        variant={u.is_active ? 'danger' : 'secondary'}
                        onClick={() => toggleUserStatus(u)}
                      >
                        {u.is_active ? t('disable') : t('enable')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="text-xs text-[var(--color-text-subtle)] py-6 text-center">{t('noUsers')}</p>
          )}
        </div>
      </Card>

      <Card padding="md">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <UserPlus size={16} /> {t('addUserTitle')}
            </span>
          }
          description={t('addUserDesc')}
        />
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('username')}
            value={newUser.username}
            onChange={(e) => setNewUser((v) => ({ ...v, username: e.target.value }))}
            placeholder={t('phUsername')}
          />
          <Input
            label={t('password')}
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser((v) => ({ ...v, password: e.target.value }))}
            placeholder={t('phPassword')}
          />
          <Input
            label={t('nicknameOpt')}
            value={newUser.nickname}
            onChange={(e) => setNewUser((v) => ({ ...v, nickname: e.target.value }))}
            placeholder={t('phNickname')}
          />
          <Input
            label={t('emailOpt')}
            type="email"
            value={newUser.email}
            onChange={(e) => setNewUser((v) => ({ ...v, email: e.target.value }))}
            placeholder={t('phEmail')}
          />
          <div className="md:col-span-2">
            <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">{t('roleLabel')}</p>
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
                  {r === 'admin' ? t('roleAdmin') : t('roleUser')}
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <Button size="sm" loading={creatingUser} onClick={createUser}>
              {t('createUser')}
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ScrollText size={16} /> {t('logsTitle')}
            </span>
          }
          description={t('logsTotal', { total })}
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                <th className="py-2 pr-2 font-medium w-[11rem]">{t('colTime')}</th>
                <th className="py-2 pr-2 font-medium min-w-[14rem]">{t('colSummary')}</th>
                <th className="py-2 pr-2 font-medium">{t('colActor')}</th>
                <th className="py-2 pr-2 font-medium">{t('colResource')}</th>
                <th className="py-2 pr-2 font-medium">{t('colTech')}</th>
                <th className="py-2 pr-2 font-medium">{t('colIp')}</th>
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
                    {row.actor_label ||
                      (row.actor_user_id
                        ? t('actorUser', { id: row.actor_user_id.slice(0, 8) })
                        : t('actorSystem'))}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-muted)] text-[12px]">
                    {row.resource_label || t('dash')}
                  </td>
                  <td className="py-2 pr-2 font-mono text-[10px] text-[var(--color-text-subtle)] break-all max-w-[10rem]">
                    {row.action}
                    {row.resource_id ? ` · ${row.resource_id.slice(0, 8)}…` : ''}
                  </td>
                  <td className="py-2 pr-2 text-[var(--color-text-subtle)] whitespace-nowrap">{row.ip || t('dash')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <p className="text-xs text-[var(--color-text-subtle)] py-6 text-center">{t('noLogs')}</p>}
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
              {t('prevPage')}
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
              {t('nextPage')}
            </Button>
          </div>
        )}
      </Card>

      {resetUser && (
        <Modal
          open
          onClose={closeResetPasswordModal}
          title={t('resetPwdModalTitle')}
          description={t('resetPwdModalDesc')}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={resetSubmitting} onClick={closeResetPasswordModal}>
                {t('cancel')}
              </Button>
              <Button size="sm" loading={resetSubmitting} onClick={() => void submitResetPassword()}>
                {t('confirmResetPwd')}
              </Button>
            </div>
          }
        >
          <p className="text-xs font-medium text-[var(--color-text)] mb-1">
            {t('colUser')}: <span className="text-[var(--color-brand)]">{resetUser.username}</span>
          </p>
          {resetModalErr && (
            <p className="text-xs text-[var(--color-danger)] mb-3">{resetModalErr}</p>
          )}
          <div className="space-y-3">
            <Input
              label={t('resetPwdNew')}
              type="password"
              autoComplete="new-password"
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
            />
            <Input
              label={t('resetPwdConfirm')}
              type="password"
              autoComplete="new-password"
              value={resetPwd2}
              onChange={(e) => setResetPwd2(e.target.value)}
            />
            <Input
              label={t('resetPwdTypeLabel')}
              value={resetPhrase}
              onChange={(e) => setResetPhrase(e.target.value)}
              placeholder={resetUser.username}
              autoComplete="off"
            />
            <label className="flex items-start gap-2 text-xs text-[var(--color-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={resetAck}
                onChange={(e) => setResetAck(e.target.checked)}
                className="mt-0.5 rounded border-[var(--color-border)]"
              />
              <span>{t('resetPwdAckLabel')}</span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
