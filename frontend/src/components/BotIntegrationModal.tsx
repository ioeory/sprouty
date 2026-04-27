import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, MessageSquare, Copy, CheckCircle, Smartphone, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { copyToClipboard } from '../lib/copyToClipboard';
import { Button, Modal, Badge } from './ui';

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

const BotIntegrationModal: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation('bot');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (open) fetchStatus();
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Bot size={16} className="text-[var(--color-brand)]" />
          {t('title')}
        </span>
      }
      description={t('description')}
    >
      <div className="space-y-5">
        {/* Status */}
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
              {copyFailed && (
                <p className="text-[11px] text-[var(--color-danger)]">{t('copyManual')}</p>
              )}
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
    </Modal>
  );
};

export default BotIntegrationModal;
