import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  Link2,
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
  Select,
} from '../components/ui';
import { useLayout } from '../components/AppLayout';
import LedgerKeywordsEditor from '../components/LedgerKeywordsEditor';
import { copyToClipboard } from '../lib/copyToClipboard';

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

interface LinkedPersonalRow {
  link_id: string;
  ledger_id: string;
  name: string;
  owner_id: string;
  owner_label: string;
  can_unlink: boolean;
}

interface FamilyLinksState {
  linked: LinkedPersonalRow[];
  candidates: { id: string; name: string }[];
}

export default function Members() {
  const { t } = useTranslation(['members', 'common']);
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
  const [familyLinks, setFamilyLinks] = useState<FamilyLinksState | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkPick, setLinkPick] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);

  const loadFamilyLinks = async (ledgerId: string) => {
    setLinksLoading(true);
    try {
      const res = await api.get(`/ledgers/${ledgerId}/linked-personal`);
      setFamilyLinks({
        linked: res.data?.linked || [],
        candidates: res.data?.candidates || [],
      });
      setLinkPick('');
    } catch {
      setFamilyLinks(null);
    } finally {
      setLinksLoading(false);
    }
  };

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
      if (currentLedger.type === 'family') {
        void loadFamilyLinks(currentLedger.id);
      } else {
        setFamilyLinks(null);
      }
    }
  }, [currentLedger?.id, currentLedger?.type]);

  const addFamilyLink = async () => {
    if (!currentLedger || !linkPick) return;
    setLinkBusy(true);
    setError('');
    try {
      await api.post(`/ledgers/${currentLedger.id}/linked-personal`, {
        personal_ledger_id: linkPick,
      });
      await loadFamilyLinks(currentLedger.id);
      await refreshLedgers();
    } catch (err: any) {
      setError(err.response?.data?.error || t('members:linkFailed'));
    } finally {
      setLinkBusy(false);
    }
  };

  const removeFamilyLink = async (personalLedgerId: string) => {
    if (!currentLedger) return;
    setLinkBusy(true);
    setError('');
    try {
      await api.delete(`/ledgers/${currentLedger.id}/linked-personal/${personalLedgerId}`);
      await loadFamilyLinks(currentLedger.id);
      await refreshLedgers();
    } catch (err: any) {
      setError(err.response?.data?.error || t('members:unlinkFailed'));
    } finally {
      setLinkBusy(false);
    }
  };

  const generateInvite = async () => {
    if (!currentLedger) return;
    setInviteLoading(true);
    setError('');
    try {
      const res = await api.post(`/ledgers/${currentLedger.id}/invite`);
      setInviteCode(res.data.code);
    } catch (err: any) {
      setError(err.response?.data?.error || t('members:inviteGenFailed'));
    } finally {
      setInviteLoading(false);
    }
  };

  const copyInvite = async () => {
    const ok = await copyToClipboard(inviteCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError(t('members:copyManual'));
    }
  };

  const confirmRemove = async () => {
    if (!removing || !currentLedger) return;
    setActionLoading(true);
    try {
      await api.delete(`/ledgers/${currentLedger.id}/members/${removing.id}`);
      setRemoving(null);
      load(currentLedger.id);
    } catch (err: any) {
      setError(err.response?.data?.error || t('members:removeFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  if (!currentLedger) {
    return (
      <Card>
        <EmptyState icon={<Users size={18} />} title={t('members:selectLedgerFirst')} />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-widest">{currentLedger.name}</p>
          <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">{t('members:title')}</h1>
          <p className="text-xs text-[var(--color-text-subtle)] mt-1">{t('members:subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" leftIcon={<LogIn size={14} />} onClick={() => setJoinOpen(true)}>
            {t('members:joinLedger')}
          </Button>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setNewLedgerOpen(true)}>
            {t('members:newLedger')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Members list */}
        <Card padding="lg">
          <CardHeader
            icon={<Users size={16} />}
            title={t('members:memberList')}
            description={
              data?.members.length
                ? t('members:memberCount', { count: data.members.length })
                : t('members:noMembersDesc')
            }
          />
          {loading ? (
            <div className="flex items-center justify-center py-10 text-[var(--color-text-subtle)]">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : !data?.members.length ? (
            <div className="mt-4">
              <EmptyState
                icon={<Users size={18} />}
                title={t('members:emptyMembersTitle')}
                description={t('members:emptyMembersDesc')}
              />
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
                            <Crown size={10} /> {t('members:owner')}
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
                        title={t('members:removeMemberTitle')}
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
            title={t('members:inviteTitle')}
            description={t('members:inviteDesc')}
          />
          <div className="mt-4 space-y-4">
            {inviteCode ? (
              <div className="p-5 rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)] border border-[var(--color-brand)]/20 text-center">
                <p className="text-[11px] text-[var(--color-brand)] uppercase tracking-widest mb-2">
                  {t('members:inviteCodeLabel')}
                </p>
                <div className="text-3xl font-mono font-semibold text-[var(--color-brand)] tracking-[0.3em]">
                  {inviteCode}
                </div>
                <p className="text-[11px] text-[var(--color-text-subtle)] mt-2">{t('members:inviteValid24h')}</p>
                <div className="flex justify-center gap-2 mt-4">
                  <Button variant="outline" size="sm" leftIcon={copied ? <CheckCircle size={12} /> : <Copy size={12} />} onClick={copyInvite}>
                    {copied ? t('members:copied') : t('members:copy')}
                  </Button>
                  <Button size="sm" loading={inviteLoading} onClick={generateInvite}>
                    {t('members:regenerate')}
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<UserPlus size={18} />}
                title={t('members:noInviteTitle')}
                description={t('members:noInviteDesc')}
                action={
                  <Button size="sm" loading={inviteLoading} onClick={generateInvite}>
                    {t('members:generateInvite')}
                  </Button>
                }
              />
            )}

            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-muted)] leading-relaxed">
              {t('members:inviteHint')}
            </div>
          </div>
        </Card>
      </div>

      {currentLedger.type === 'family' && (
        <Card padding="lg">
          <CardHeader
            icon={<Link2 size={16} />}
            title={t('members:linkPersonalTitle')}
            description={t('members:linkPersonalDesc')}
          />
          <div className="mt-4 space-y-4">
            {linksLoading ? (
              <div className="flex items-center justify-center py-8 text-[var(--color-text-subtle)]">
                <Loader2 className="animate-spin" size={18} />
              </div>
            ) : (
              <>
                {familyLinks?.linked?.length ? (
                  <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
                    {familyLinks.linked.map((row) => (
                      <li key={row.link_id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text)] truncate">{row.name}</p>
                          <p className="text-[11px] text-[var(--color-text-subtle)] truncate">
                            {t('members:ownerLine', { label: row.owner_label })}
                          </p>
                        </div>
                        {row.can_unlink && (
                          <button
                            type="button"
                            title={t('members:unlinkTitle')}
                            disabled={linkBusy}
                            onClick={() => removeFamilyLink(row.ledger_id)}
                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--color-text-muted)]">{t('members:noLinkedPersonal')}</p>
                )}

                {familyLinks && familyLinks.candidates.length > 0 ? (
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                    <div className="flex-1 min-w-0">
                      <Select
                        label={t('members:addPersonalLabel')}
                        value={linkPick}
                        onChange={(e) => setLinkPick(e.target.value)}
                        hint={t('members:addPersonalHint')}
                      >
                        <option value="">{t('members:selectPlaceholder')}</option>
                        {familyLinks.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button size="sm" disabled={!linkPick || linkBusy} loading={linkBusy} onClick={addFamilyLink}>
                      {t('members:link')}
                    </Button>
                  </div>
                ) : (
                  familyLinks && (
                    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)] px-3 py-2.5">
                      {t('members:noCandidatesHint')}
                    </p>
                  )
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {/* Quick-record ledger keywords (per-user, used by Telegram bot) */}
      <Card padding="lg">
        <CardHeader
          icon={<Zap size={16} />}
          title={t('members:keywordsTitle')}
          description={t('members:keywordsDesc')}
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
        title={t('members:removeConfirmTitle')}
        description={t('members:removeConfirmDesc')}
        footer={
          <>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t('common:cancel')}
            </Button>
            <Button variant="danger" loading={actionLoading} onClick={confirmRemove}>
              {t('members:remove')}
            </Button>
          </>
        }
      >
        {removing && (
          <p className="text-sm text-[var(--color-text)]">
            {t('members:removeLine', { name: removing.nickname || removing.username })}
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
  const { t } = useTranslation(['members', 'common']);
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
      setError(t('members:codeRequired'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/ledgers/join', { code: code.trim().toUpperCase() });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || t('members:joinFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('members:joinTitle')}
      description={t('members:joinDesc')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button loading={loading} onClick={submit}>
            {t('members:join')}
          </Button>
        </>
      }
    >
      <Input
        label={t('members:inviteCodeInput')}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder={t('members:invitePlaceholder')}
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
  const { t } = useTranslation(['members', 'common']);
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
      setError(t('members:nameRequired'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/ledgers', { name, type });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || t('members:createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('members:createLedgerTitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button loading={loading} onClick={submit}>
            {t('members:create')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label={t('common:ledgerName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('members:ledgerNamePlaceholder')}
          error={error}
        />
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">{t('members:ledgerType')}</p>
          <p className="text-[11px] text-[var(--color-text-subtle)] mb-2">{t('members:ledgerTypeHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            {(['personal', 'family'] as const).map((ledgerKind) => (
              <button
                key={ledgerKind}
                type="button"
                onClick={() => setType(ledgerKind)}
                className={`h-10 rounded-[var(--radius-md)] border text-sm font-medium transition-all ${
                  type === ledgerKind
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'
                }`}
              >
                {ledgerKind === 'personal' ? t('members:typePersonal') : t('members:typeFamily')}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
