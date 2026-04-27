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
} from 'lucide-react';
import api from '../api/client';
import { copyToClipboard } from '../lib/copyToClipboard';
import { Button, Modal, Badge, Select, Input } from './ui';
import { useLayout } from './AppLayout';

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

interface PushSettings {
  id?: string;
  enabled: boolean;
  ledger_id: string;
  schedule_type: string;
  push_hour: number;
  push_minute: number;
  weekday: number;
  timezone: string;
  include_budget_remaining: boolean;
  include_today_expense: boolean;
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
  const [push, setPush] = useState<PushSettings>({
    enabled: false,
    ledger_id: '',
    schedule_type: 'daily',
    push_hour: 9,
    push_minute: 0,
    weekday: 1,
    timezone: 'Asia/Shanghai',
    include_budget_remaining: true,
    include_today_expense: true,
    custom_prefix: '',
  });

  useEffect(() => {
    if (open) fetchStatus();
  }, [open]);

  const loadPush = useCallback(async () => {
    setPushLoading(true);
    setPushErr('');
    try {
      const res = await api.get<PushSettings>('/push-settings');
      const d = res.data;
      const nilUUID = '00000000-0000-0000-0000-000000000000';
      let lid = d.ledger_id && d.ledger_id !== nilUUID ? d.ledger_id : '';
      if (!lid && currentLedger?.id) lid = currentLedger.id;
      if (!lid && ledgers[0]?.id) lid = ledgers[0].id;
      setPush({
        enabled: !!d.enabled,
        ledger_id: lid,
        schedule_type: d.schedule_type === 'weekly' ? 'weekly' : 'daily',
        push_hour: Number.isFinite(d.push_hour) ? d.push_hour : 9,
        push_minute: Number.isFinite(d.push_minute) ? d.push_minute : 0,
        weekday: Number.isFinite(d.weekday) ? d.weekday : 1,
        timezone: d.timezone || 'Asia/Shanghai',
        include_budget_remaining: d.include_budget_remaining !== false,
        include_today_expense: d.include_today_expense !== false,
        custom_prefix: d.custom_prefix || '',
      });
      setTzCustom(!COMMON_TIMEZONES.includes(d.timezone || ''));
    } catch {
      setPushErr(t('pushLoadError'));
    } finally {
      setPushLoading(false);
    }
  }, [currentLedger?.id, ledgers, t]);

  useEffect(() => {
    if (open && tab === 'push') void loadPush();
  }, [open, tab, loadPush]);

  useEffect(() => {
    if (!open) {
      setTab('link');
      setPin(null);
      setPushOk('');
      setPushErr('');
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

  const savePush = async () => {
    setPushSaving(true);
    setPushErr('');
    setPushOk('');
    try {
      const tz = push.timezone.trim() || 'Asia/Shanghai';
      await api.put('/push-settings', {
        enabled: push.enabled,
        ledger_id: push.ledger_id,
        schedule_type: push.schedule_type,
        push_hour: push.push_hour,
        push_minute: push.push_minute,
        weekday: push.weekday,
        timezone: tz,
        include_budget_remaining: push.include_budget_remaining,
        include_today_expense: push.include_today_expense,
        custom_prefix: push.custom_prefix.trim(),
      });
      setPushOk(t('pushSaved'));
      setTimeout(() => setPushOk(''), 3000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setPushErr(msg || t('pushSaveError'));
    } finally {
      setPushSaving(false);
    }
  };

  const testPush = async () => {
    setPushSaving(true);
    setPushErr('');
    setPushOk('');
    try {
      await api.post('/push-settings/test');
      setPushOk(t('pushTestOk'));
      setTimeout(() => setPushOk(''), 4000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setPushErr(msg || t('pushTestError'));
    } finally {
      setPushSaving(false);
    }
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-[var(--color-border)]"
                  checked={push.enabled}
                  onChange={(e) => setPush((p) => ({ ...p, enabled: e.target.checked }))}
                />
                <span>{t('pushEnable')}</span>
              </label>

              <Select
                label={t('pushLedger')}
                value={push.ledger_id}
                onChange={(e) => setPush((p) => ({ ...p, ledger_id: e.target.value }))}
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
                value={push.schedule_type}
                onChange={(e) => setPush((p) => ({ ...p, schedule_type: e.target.value }))}
              >
                <option value="daily">{t('pushDaily')}</option>
                <option value="weekly">{t('pushWeekly')}</option>
              </Select>

              {push.schedule_type === 'weekly' && (
                <Select
                  label={t('pushWeekday')}
                  value={String(push.weekday)}
                  onChange={(e) => setPush((p) => ({ ...p, weekday: Number(e.target.value) }))}
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

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={t('pushHour')}
                  type="number"
                  min={0}
                  max={23}
                  value={push.push_hour}
                  onChange={(e) => setPush((p) => ({ ...p, push_hour: Math.min(23, Math.max(0, Number(e.target.value))) }))}
                />
                <Input
                  label={t('pushMinute')}
                  type="number"
                  min={0}
                  max={59}
                  value={push.push_minute}
                  onChange={(e) => setPush((p) => ({ ...p, push_minute: Math.min(59, Math.max(0, Number(e.target.value))) }))}
                />
              </div>

              {!tzCustom ? (
                <Select
                  label={t('pushTimezone')}
                  value={COMMON_TIMEZONES.includes(push.timezone) ? push.timezone : '__custom__'}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__custom__') {
                      setTzCustom(true);
                    } else {
                      setPush((p) => ({ ...p, timezone: v }));
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
                    value={push.timezone}
                    onChange={(e) => setPush((p) => ({ ...p, timezone: e.target.value }))}
                    placeholder="IANA, e.g. Asia/Shanghai"
                  />
                  <button
                    type="button"
                    className="text-xs text-[var(--color-brand)] hover:underline"
                    onClick={() => {
                      setTzCustom(false);
                      if (!COMMON_TIMEZONES.includes(push.timezone)) {
                        setPush((p) => ({ ...p, timezone: 'Asia/Shanghai' }));
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
                  checked={push.include_budget_remaining}
                  onChange={(e) => setPush((p) => ({ ...p, include_budget_remaining: e.target.checked }))}
                />
                <span>{t('pushIncludeBudget')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-[var(--color-border)]"
                  checked={push.include_today_expense}
                  onChange={(e) => setPush((p) => ({ ...p, include_today_expense: e.target.checked }))}
                />
                <span>{t('pushIncludeToday')}</span>
              </label>

              <Input
                label={t('pushCustomPrefix')}
                value={push.custom_prefix}
                onChange={(e) => setPush((p) => ({ ...p, custom_prefix: e.target.value }))}
                placeholder={t('pushCustomPlaceholder')}
              />
              <p className="text-[11px] text-[var(--color-text-subtle)]">{t('pushCustomHint')}</p>

              {pushErr && <p className="text-xs text-[var(--color-danger)]">{pushErr}</p>}
              {pushOk && <p className="text-xs text-[var(--color-success)]">{pushOk}</p>}

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <Button fullWidth loading={pushSaving} onClick={savePush} disabled={!push.ledger_id}>
                  {t('pushSave')}
                </Button>
                <Button
                  fullWidth
                  variant="secondary"
                  loading={pushSaving}
                  onClick={testPush}
                  disabled={!status?.connected}
                >
                  {t('pushTest')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default BotIntegrationModal;
