import React, { useEffect, useState } from 'react';
import {
  Users,
  Crown,
  UserPlus,
  LogIn,
  Copy,
  CheckCircle,
  Trash2,
  Loader2,
  Plus,
  Zap,
} from 'lucide-react';
import api from '../api/client';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  Badge,
} from '../components/ui';
import { useLayout } from '../components/AppLayout';
import LedgerKeywordsEditor from '../components/LedgerKeywordsEditor';

interface Member {
  id: string;
  username: string;
  nickname: string;
  email?: string;
  is_owner: boolean;
}

interface MembersResp {
  members: Member[];
  is_owner: boolean;
}

export default function Members() {
  const { currentLedger, refreshLedgers } = useLayout();
  const [data, setData] = useState<MembersResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteCode, setInviteCode] = useState<string>('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [newLedgerOpen, setNewLedgerOpen] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (ledgerId: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/ledgers/${ledgerId}/members`);
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentLedger) {
      setInviteCode('');
      load(currentLedger.id);
    }
  }, [currentLedger?.id]);

  const generateInvite = async () => {
    if (!currentLedger) return;
    setInviteLoading(true);
    setError('');
    try {
      const res = await api.post(`/ledgers/${currentLedger.id}/invite`);
      setInviteCode(res.data.code);
    } catch (err: any) {
      setError(err.response?.data?.error || '生成邀请码失败');
    } finally {
      setInviteLoading(false);
    }
  };

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const confirmRemove = async () => {
    if (!removing || !currentLedger) return;
    setActionLoading(true);
    try {
      await api.delete(`/ledgers/${currentLedger.id}/members/${removing.id}`);
      setRemoving(null);
      load(currentLedger.id);
    } catch (err: any) {
      setError(err.response?.data?.error || '移除失败');
    } finally {
      setActionLoading(false);
    }
  };

  if (!currentLedger) {
    return (
      <Card>
        <EmptyState icon={<Users size={18} />} title="请先选择账本" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-widest">{currentLedger.name}</p>
          <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">成员与共享</h1>
          <p className="text-xs text-[var(--color-text-subtle)] mt-1">
            邀请家人或伙伴共同使用同一个账本
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" leftIcon={<LogIn size={14} />} onClick={() => setJoinOpen(true)}>
            加入账本
          </Button>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setNewLedgerOpen(true)}>
            新建账本
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Members list */}
        <Card padding="lg">
          <CardHeader
            icon={<Users size={16} />}
            title="成员列表"
            description={data?.members.length ? `${data.members.length} 位成员` : '暂无成员'}
          />
          {loading ? (
            <div className="flex items-center justify-center py-10 text-[var(--color-text-subtle)]">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : !data?.members.length ? (
            <div className="mt-4">
              <EmptyState icon={<Users size={18} />} title="暂无成员" description="生成邀请码让家人加入" />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--color-border)]">
              {data.members.map((m) => {
                const initial = (m.nickname || m.username || 'U')[0].toUpperCase();
                return (
                  <li key={m.id} className="group flex items-center gap-3 py-3">
                    <div className="w-9 h-9 rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center text-sm font-semibold">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate flex items-center gap-1.5">
                        {m.nickname || m.username}
                        {m.is_owner && (
                          <Badge tone="brand">
                            <Crown size={10} /> 所有者
                          </Badge>
                        )}
                      </p>
                      <p className="text-[11px] text-[var(--color-text-subtle)] truncate">
                        @{m.username}
                        {m.email && <span className="ml-1.5">· {m.email}</span>}
                      </p>
                    </div>
                    {data.is_owner && !m.is_owner && (
                      <button
                        onClick={() => setRemoving(m)}
                        title="移除成员"
                        className="opacity-0 group-hover:opacity-100 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] transition-all"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Invite card */}
        <Card padding="lg">
          <CardHeader
            icon={<UserPlus size={16} />}
            title="邀请新成员"
            description="生成邀请码，分享给要加入的用户"
          />
          <div className="mt-4 space-y-4">
            {inviteCode ? (
              <div className="p-5 rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)] border border-[var(--color-brand)]/20 text-center">
                <p className="text-[11px] text-[var(--color-brand)] uppercase tracking-widest mb-2">邀请码</p>
                <div className="text-3xl font-mono font-semibold text-[var(--color-brand)] tracking-[0.3em]">
                  {inviteCode}
                </div>
                <p className="text-[11px] text-[var(--color-text-subtle)] mt-2">24 小时内有效</p>
                <div className="flex justify-center gap-2 mt-4">
                  <Button variant="outline" size="sm" leftIcon={copied ? <CheckCircle size={12} /> : <Copy size={12} />} onClick={copyInvite}>
                    {copied ? '已复制' : '复制'}
                  </Button>
                  <Button size="sm" loading={inviteLoading} onClick={generateInvite}>
                    重新生成
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<UserPlus size={18} />}
                title="还没有邀请码"
                description="点击下方按钮生成一个 8 位的邀请码"
                action={
                  <Button size="sm" loading={inviteLoading} onClick={generateInvite}>
                    生成邀请码
                  </Button>
                }
              />
            )}

            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-muted)] leading-relaxed">
              对方登录后进入「成员共享 · 加入账本」，输入此邀请码即可加入当前账本。
            </div>
          </div>
        </Card>
      </div>

      {/* Quick-record ledger keywords (per-user, used by Telegram bot) */}
      <Card padding="lg">
        <CardHeader
          icon={<Zap size={16} />}
          title="快速记账关键字"
          description="在 Bot 消息中写入关键字，即可把这一笔记入当前账本"
        />
        <div className="mt-4">
          <LedgerKeywordsEditor ledgerId={currentLedger.id} />
        </div>
      </Card>

      <JoinLedgerModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onSuccess={async () => {
          await refreshLedgers();
          setJoinOpen(false);
        }}
      />

      <CreateLedgerModal
        open={newLedgerOpen}
        onClose={() => setNewLedgerOpen(false)}
        onSuccess={async () => {
          await refreshLedgers();
          setNewLedgerOpen(false);
        }}
      />

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title="移除成员？"
        description="该成员将失去此账本的访问权限"
        footer={
          <>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button variant="danger" loading={actionLoading} onClick={confirmRemove}>
              移除
            </Button>
          </>
        }
      >
        {removing && (
          <p className="text-sm text-[var(--color-text)]">
            将移除 <span className="font-semibold">{removing.nickname || removing.username}</span>
          </p>
        )}
      </Modal>

      {error && (
        <div className="fixed bottom-6 right-6 p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)] shadow-lg animate-slide-up">
          {error}
        </div>
      )}
    </div>
  );
}

const JoinLedgerModal: React.FC<{ open: boolean; onClose: () => void; onSuccess: () => void }> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setCode('');
      setError('');
    }
  }, [open]);

  const submit = async () => {
    if (!code.trim()) {
      setError('请输入邀请码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/ledgers/join', { code: code.trim().toUpperCase() });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || '加入失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="通过邀请码加入"
      description="输入对方提供的 8 位邀请码"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button loading={loading} onClick={submit}>
            加入
          </Button>
        </>
      }
    >
      <Input
        label="邀请码"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="例如：AB12CD34"
        maxLength={8}
        className="font-mono tracking-widest text-center uppercase"
        error={error}
      />
    </Modal>
  );
};

const CreateLedgerModal: React.FC<{ open: boolean; onClose: () => void; onSuccess: () => void }> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<'personal' | 'family'>('family');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setError('');
      setType('family');
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      setError('请填写名称');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/ledgers', { name, type });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="新建账本"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button loading={loading} onClick={submit}>
            创建
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="账本名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：家庭账本 / 出差报销"
          error={error}
        />
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">类型</p>
          <p className="text-[11px] text-[var(--color-text-subtle)] mb-2">
            个人：仅自己使用；家庭：可生成邀请码让家人加入同一账本（加入后账本变为「家庭」类型）。
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(['personal', 'family'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`h-10 rounded-[var(--radius-md)] border text-sm font-medium transition-all ${
                  type === t
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'
                }`}
              >
                {t === 'personal' ? '个人' : '家庭'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
