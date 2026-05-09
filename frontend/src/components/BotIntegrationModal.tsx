import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  MessageSquare,
  Copy,
  CheckCircle,
  Smartphone,
  RefreshCw,
  Bell,
  Link2,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import api from '../api/client';
import { copyToClipboard } from '../lib/copyToClipboard';
import { Button, Modal, Badge, Select, Input } from './ui';
import { useLayout, type Ledger } from './AppLayout';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Platform {
  Platform: string;
  Username?: string;
}

interface Status {
  connected: boolean;
  platforms: Platform[];
}

export interface PushSubscription {
  id: string;
  user_id?: string;
  name: string;
  message_locale: string;
  enabled: boolean;
  ledger_id: string;
  schedule_type: string;
  push_hour: number;
  push_minute: number;
  weekday: number;
  day_of_month: number;
  timezone: string;
  include_budget_remaining: boolean;
  include_today_expense: boolean;
  include_comparison: boolean;
  include_top_categories: boolean;
  include_anomaly: boolean;
  custom_prefix: string;
}

const COMMON_TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
];

function defaultDraft(ledgers: Ledger[], current: Ledger | null): PushSubscription {
  const nilUUID = '00000000-0000-0000-0000-000000000000';
  let lid = current?.id || '';
  if (!lid && ledgers[0]?.id) lid = ledgers[0].id;
  if (lid === nilUUID) lid = ledgers[0]?.id || '';
  return {
    id: '',
    name: '',
    message_locale: 'auto',
    enabled: false,
    ledger_id: lid,
    schedule_type: 'daily',
    push_hour: 9,
    push_minute: 0,
    weekday: 1,
    day_of_month: 1,
    timezone: 'Asia/Shanghai',
    include_budget_remaining: true,
    include_today_expense: true,
    include_comparison: true,
    include_top_categories: true,
    include_anomaly: true,
    custom_prefix: '',
  };
}

const BotIntegrationModal: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation('bot');
  const { ledgers, currentLedger } = useLayout();
  const [tab, setTab] = useState<'link' | 'push'>('link');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const [pushLoading, setPushLoading] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [pushErr, setPushErr] = useState('');
  const [pushOk, setPushOk] = useState('');
  const [tzCustom, setTzCustom] = useState(false);
  const [subs, setSubs] = useState<PushSubscription[]>([]);
  const [draft, setDraft] = useState<PushSubscription | null>(null);

  const ledgerName = (id: string) => ledgers.find((l) => l.id === id)?.name || id.slice(0, 8);

  const scheduleSummary = (s: PushSubscription) => {
    const hm = `${String(s.push_hour).padStart(2, '0')}:${String(s.push_minute).padStart(2, '0')}`;
    if (s.schedule_type === 'weekly') {
      const d = ['pushDay0', 'pushDay1', 'pushDay2', 'pushDay3', 'pushDay4', 'pushDay5', 'pushDay6'] as const;
      const key = d[s.weekday] ?? 'pushDay0';
      return `${t('pushWeekly')} · ${t(key)} · ${hm}`;
    }
    if (s.schedule_type === 'monthly') {
      return `${t('pushMonthly')} · ${t('pushDayOfMonth', { day: s.day_of_month })} · ${hm}`;
    }
    return `${t('pushDaily')} · ${hm}`;
  };

  useEffect(() => {
    if (open) fetchStatus();
  }, [open]);

  const loadPush = useCallback(async () => {
    setPushLoading(true);
    setPushErr('');
    try {
      const res = await api.get<{ subscriptions: PushSubscription[] }>('/push-subscriptions');
      setSubs(res.data?.subscriptions || []);
    } catch {
      setPushErr(t('pushLoadError'));
      setSubs([]);
    } finally {
      setPushLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open && tab === 'push') void loadPush();
  }, [open, tab, loadPush]);

  useEffect(() => {
    if (!open) {
      setTab('link');
      setPin(null);
      setPushOk('');
      setPushErr('');
      setDraft(null);
    }
  }, [open]);

  const fetchStatus = async () => {
    try {
      const res = await api.get('/bot/status');
      setStatus(res.data);
    } catch (err) {
      console.error('Failed to fetch bot status', err);
    }
  };

  const generatePin = async () => {
    setLoading(true);
    try {
      const res = await api.get('/bot/binding-code');
      setPin(res.data.code);
      setBotUsername(res.data.bot_username || '');
    } catch (err) {
      console.error('Failed to generate PIN', err);
    } finally {
      setLoading(false);
    }
  };

  const copyCommand = async () => {
    if (!pin) return;
    setCopyFailed(false);
    const ok = await copyToClipboard(`/bind ${pin}`);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
    }
  };

  const tgUrl = botUsername
    ? `https://t.me/${botUsername}${pin ? `?start=bind_${pin}` : ''}`
    : 'https://t.me';

  const openNewDraft = () => {
    const d = defaultDraft(ledgers, currentLedger);
    setDraft(d);
    setTzCustom(!COMMON_TIMEZONES.includes(d.timezone));
    setPushErr('');
  };

  const openEditDraft = (s: PushSubscription) => {
    setDraft({ ...s });
    setTzCustom(!COMMON_TIMEZONES.includes(s.timezone || ''));
    setPushErr('');
  };

  const closeDraft = () => {
    setDraft(null);
    setTzCustom(false);
  };

  const saveDraft = async () => {
    if (!draft || !draft.ledger_id) return;
    setPushSaving(true);
    setPushErr('');
    setPushOk('');
    try {
      const body = {
        name: draft.name.trim(),
        message_locale: draft.message_locale || 'auto',
        enabled: draft.enabled,
        ledger_id: draft.ledger_id,
        schedule_type: draft.schedule_type,
        push_hour: draft.push_hour,
        push_minute: draft.push_minute,
        weekday: draft.weekday,
        day_of_month: draft.day_of_month,
        timezone: draft.timezone.trim() || 'Asia/Shanghai',
        include_budget_remaining: draft.include_budget_remaining,
        include_today_expense: draft.include_today_expense,
        include_comparison: draft.include_comparison,
        include_top_categories: draft.include_top_categories,
        include_anomaly: draft.include_anomaly,
        custom_prefix: draft.custom_prefix.trim(),
      };
      if (!draft.id) {
        await api.post('/push-subscriptions', body);
      } else {
        await api.put(`/push-subscriptions/${draft.id}`, body);
      }
      setPushOk(t('pushSaved'));
      setTimeout(() => setPushOk(''), 3000);
      closeDraft();
      await loadPush();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setPushErr(msg || t('pushSaveError'));
    } finally {
      setPushSaving(false);
    }
  };

  const deleteSub = async (id: string) => {
    if (!window.confirm(t('pushDeleteConfirm'))) return;
    setPushSaving(true);
    setPushErr('');
    try {
      await api.delete(`/push-subscriptions/${id}`);
      await loadPush();
      if (draft?.id === id) closeDraft();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setPushErr(msg || t('pushSaveError'));
    } finally {
      setPushSaving(false);
    }
  };

  const testSub = async (id: string) => {
    setPushSaving(true);
    setPushErr('');
    setPushOk('');
    try {
      await api.post(`/push-subscriptions/${id}/test`);
      setPushOk(t('pushTestOk'));
      setTimeout(() => setPushOk(''), 4000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setPushErr(msg || t('pushTestError'));
    } finally {
      setPushSaving(false);
    }
  };

  const setDraftField = <K extends keyof PushSubscription>(key: K, value: PushSubscription[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={tab === 'push' ? 'lg' : 'md'}
      title={
        <span className="flex items-center gap-2">
          <Bot size={16} className="text-[var(--color-brand)]" />
          {t('title')}
        </span>
      }
      description={t('description')}
    >
      <div className="flex gap-1 p-1 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] mb-4">
        <button
          type="button"
          onClick={() => setTab('link')}
          className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-[var(--radius-sm)] text-xs font-medium transition-colors ${
            tab === 'link'
              ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          <Link2 size={14} />
          {t('tabLink')}
        </button>
        <button
          type="button"
          onClick={() => setTab('push')}
          className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-[var(--radius-sm)] text-xs font-medium transition-colors ${
            tab === 'push'
              ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          <Bell size={14} />
          {t('tabPush')}
        </button>
      </div>

      {tab === 'link' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] border border-[var(--color-border)]">
            <span className="text-xs text-[var(--color-text-muted)]">{t('status')}</span>
            {status?.connected ? (
              <Badge tone="success" dot>
                <CheckCircle size={12} /> {t('connected')}
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                {t('notBound')}
              </Badge>
            )}
          </div>

          {!pin && !status?.connected && (
            <>
              <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                {t('intro')}
                <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--color-surface-muted)] font-mono text-xs">
                  {t('introExampleCode')}
                </code>
                {t('introExample')}
              </p>
              <Button
                fullWidth
                loading={loading}
                leftIcon={<Smartphone size={16} />}
                onClick={generatePin}
              >
                {t('generatePin')}
              </Button>
            </>
          )}

          {pin && (
            <div className="space-y-4 animate-slide-up">
              <div className="p-5 rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)] border border-[var(--color-brand)]/20 text-center">
                <p className="text-[11px] text-[var(--color-brand)] uppercase tracking-widest mb-2">{t('yourPin')}</p>
                <div className="text-3xl font-mono font-semibold text-[var(--color-brand)] tracking-[0.4em]">{pin}</div>
                <p className="text-[11px] text-[var(--color-text-subtle)] mt-2">{t('pinValid5m')}</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('nextStep')}</p>
                <div className="flex gap-2">
                  <a
                    href={tgUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm flex items-center justify-center gap-1.5 hover:bg-[var(--color-surface-muted)] transition-colors"
                  >
                    <MessageSquare size={14} />
                    {botUsername ? `@${botUsername}` : t('openTg')}
                  </a>
                  <button
                    type="button"
                    onClick={copyCommand}
                    className="h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm flex items-center gap-1.5 hover:bg-[var(--color-surface-muted)] transition-colors"
                    title={t('copyBindTitle')}
                  >
                    {copied ? (
                      <>
                        <CheckCircle size={14} className="text-[var(--color-success)]" /> {t('copied')}
                      </>
                    ) : (
                      <>
                        <Copy size={14} /> {t('copyCmd')}
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-[var(--color-text-subtle)]">
                  {t('pasteHint')}{' '}
                  <code className="px-1 py-0.5 rounded bg-[var(--color-surface-muted)] font-mono">/bind {pin}</code>{' '}
                  {t('pasteHintEnd')}
                </p>
                {copyFailed && <p className="text-[11px] text-[var(--color-danger)]">{t('copyManual')}</p>}
              </div>

              <Button variant="ghost" fullWidth leftIcon={<RefreshCw size={14} />} onClick={generatePin} loading={loading}>
                {t('regeneratePin')}
              </Button>
            </div>
          )}

          {status?.connected && (
            <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-success-soft)] border border-[var(--color-success)]/20 space-y-2">
              <p className="text-sm font-medium text-[var(--color-success)]">{t('boundTitle')}</p>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                {t('boundHint')}
                <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--color-surface)] font-mono text-[var(--color-brand)]">
                  {t('boundExample1')}
                </code>
                {t('boundOr')}
                <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--color-surface)] font-mono text-[var(--color-brand)]">
                  {t('boundExample2')}
                </code>
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'push' && (
        <div className="space-y-4 text-sm">
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{t('pushIntro')}</p>
          {!status?.connected && (
            <p className="text-xs text-[var(--color-danger)] rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-3 py-2">
              {t('pushNeedTelegram')}
            </p>
          )}

          {pushLoading ? (
            <p className="text-xs text-[var(--color-text-subtle)]">{t('pushLoading')}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('pushListTitle')}</p>
                <Button size="sm" variant="outline" leftIcon={<Plus size={14} />} onClick={openNewDraft} disabled={!!draft}>
                  {t('pushAdd')}
                </Button>
              </div>

              {subs.length === 0 && !draft && (
                <p className="text-xs text-[var(--color-text-subtle)] border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)] px-3 py-3">
                  {t('pushListEmpty')}
                </p>
              )}

              <ul className="space-y-2">
                {subs.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">
                        {s.name?.trim() || t('pushUntitled')}
                        {s.enabled ? (
                          <Badge tone="success" className="ml-2 text-[10px]">
                            {t('pushOn')}
                          </Badge>
                        ) : (
                          <span className="ml-2 text-[10px] text-[var(--color-text-subtle)]">{t('pushOff')}</span>
                        )}
                      </p>
                      <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                        {ledgerName(s.ledger_id)} · {scheduleSummary(s)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title={t('pushEdit')}
                        disabled={!!draft}
                        onClick={() => openEditDraft(s)}
                        className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        title={t('pushTest')}
                        disabled={!status?.connected || pushSaving}
                        onClick={() => testSub(s.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] text-[var(--color-text-muted)] text-[10px] font-medium"
                      >
                        T
                      </button>
                      <button
                        type="button"
                        title={t('pushDelete')}
                        disabled={pushSaving}
                        onClick={() => deleteSub(s.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {draft && (
                <div className="space-y-4 pt-2 border-t border-[var(--color-border)]">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-[var(--color-text)]">
                      {draft.id ? t('pushEditTitle') : t('pushNewTitle')}
                    </p>
                    <button type="button" className="text-xs text-[var(--color-brand)] hover:underline" onClick={closeDraft}>
                      {t('pushCancelForm')}
                    </button>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-[var(--color-border)]"
                      checked={draft.enabled}
                      onChange={(e) => setDraftField('enabled', e.target.checked)}
                    />
                    <span>{t('pushEnable')}</span>
                  </label>

                  <Input
                    label={t('pushNameLabel')}
                    value={draft.name}
                    onChange={(e) => setDraftField('name', e.target.value)}
                    placeholder={t('pushNamePlaceholder')}
                  />

                  <Select
                    label={t('pushMessageLocale')}
                    value={draft.message_locale || 'auto'}
                    onChange={(e) => setDraftField('message_locale', e.target.value)}
                  >
                    <option value="auto">{t('pushLocaleAuto')}</option>
                    <option value="zh-CN">{t('pushLocaleZh')}</option>
                    <option value="en">{t('pushLocaleEn')}</option>
                  </Select>

                  <Select
                    label={t('pushLedger')}
                    value={draft.ledger_id}
                    onChange={(e) => setDraftField('ledger_id', e.target.value)}
                  >
                    <option value="">{t('pushLedgerPlaceholder')}</option>
                    {ledgers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>

                  <Select
                    label={t('pushSchedule')}
                    value={draft.schedule_type}
                    onChange={(e) => setDraftField('schedule_type', e.target.value)}
                  >
                    <option value="daily">{t('pushDaily')}</option>
                    <option value="weekly">{t('pushWeekly')}</option>
                    <option value="monthly">{t('pushMonthly')}</option>
                  </Select>

                  {draft.schedule_type === 'weekly' && (
                    <Select
                      label={t('pushWeekday')}
                      value={String(draft.weekday)}
                      onChange={(e) => setDraftField('weekday', Number(e.target.value))}
                    >
                      <option value="0">{t('pushDay0')}</option>
                      <option value="1">{t('pushDay1')}</option>
                      <option value="2">{t('pushDay2')}</option>
                      <option value="3">{t('pushDay3')}</option>
                      <option value="4">{t('pushDay4')}</option>
                      <option value="5">{t('pushDay5')}</option>
                      <option value="6">{t('pushDay6')}</option>
                    </Select>
                  )}

                  {draft.schedule_type === 'monthly' && (
                    <Input
                      label={t('pushDayOfMonthLabel')}
                      type="number"
                      min={1}
                      max={31}
                      value={draft.day_of_month}
                      onChange={(e) =>
                        setDraftField('day_of_month', Math.min(31, Math.max(1, Number(e.target.value) || 1)))
                      }
                    />
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label={t('pushHour')}
                      type="number"
                      min={0}
                      max={23}
                      value={draft.push_hour}
                      onChange={(e) =>
                        setDraftField('push_hour', Math.min(23, Math.max(0, Number(e.target.value))))
                      }
                    />
                    <Input
                      label={t('pushMinute')}
                      type="number"
                      min={0}
                      max={59}
                      value={draft.push_minute}
                      onChange={(e) =>
                        setDraftField('push_minute', Math.min(59, Math.max(0, Number(e.target.value))))
                      }
                    />
                  </div>

                  {!tzCustom ? (
                    <Select
                      label={t('pushTimezone')}
                      value={COMMON_TIMEZONES.includes(draft.timezone) ? draft.timezone : '__custom__'}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__custom__') {
                          setTzCustom(true);
                        } else {
                          setDraftField('timezone', v);
                        }
                      }}
                    >
                      {COMMON_TIMEZONES.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                      <option value="__custom__">{t('pushTimezoneCustom')}</option>
                    </Select>
                  ) : (
                    <div className="space-y-1.5">
                      <Input
                        label={t('pushTimezone')}
                        value={draft.timezone}
                        onChange={(e) => setDraftField('timezone', e.target.value)}
                        placeholder="IANA, e.g. Asia/Shanghai"
                      />
                      <button
                        type="button"
                        className="text-xs text-[var(--color-brand)] hover:underline"
                        onClick={() => {
                          setTzCustom(false);
                          if (!COMMON_TIMEZONES.includes(draft.timezone)) {
                            setDraftField('timezone', 'Asia/Shanghai');
                          }
                        }}
                      >
                        {t('pushTimezonePreset')}
                      </button>
                    </div>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-[var(--color-border)]"
                      checked={draft.include_budget_remaining}
                      onChange={(e) => setDraftField('include_budget_remaining', e.target.checked)}
                    />
                    <span>{t('pushIncludeBudget')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-[var(--color-border)]"
                      checked={draft.include_today_expense}
                      onChange={(e) => setDraftField('include_today_expense', e.target.checked)}
                    />
                    <span>{t('pushIncludeToday')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-[var(--color-border)]"
                      checked={draft.include_comparison}
                      onChange={(e) => setDraftField('include_comparison', e.target.checked)}
                    />
                    <span>{t('pushIncludeComparison')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-[var(--color-border)]"
                      checked={draft.include_top_categories}
                      onChange={(e) => setDraftField('include_top_categories', e.target.checked)}
                    />
                    <span>{t('pushIncludeTopCategories')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-[var(--color-border)]"
                      checked={draft.include_anomaly}
                      onChange={(e) => setDraftField('include_anomaly', e.target.checked)}
                    />
                    <span>{t('pushIncludeAnomaly')}</span>
                  </label>

                  <Input
                    label={t('pushCustomPrefix')}
                    value={draft.custom_prefix}
                    onChange={(e) => setDraftField('custom_prefix', e.target.value)}
                    placeholder={t('pushCustomPlaceholder')}
                  />
                  <p className="text-[11px] text-[var(--color-text-subtle)]">{t('pushCustomHint')}</p>

                  {pushErr && <p className="text-xs text-[var(--color-danger)]">{pushErr}</p>}
                  {pushOk && <p className="text-xs text-[var(--color-success)]">{pushOk}</p>}

                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button fullWidth loading={pushSaving} onClick={saveDraft} disabled={!draft.ledger_id}>
                      {t('pushSave')}
                    </Button>
                    {draft.id ? (
                      <Button
                        fullWidth
                        variant="secondary"
                        loading={pushSaving}
                        onClick={() => testSub(draft.id)}
                        disabled={!status?.connected}
                      >
                        {t('pushTest')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}

              {!draft && (
                <>
                  {pushErr && <p className="text-xs text-[var(--color-danger)]">{pushErr}</p>}
                  {pushOk && <p className="text-xs text-[var(--color-success)]">{pushOk}</p>}
                </>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default BotIntegrationModal;
