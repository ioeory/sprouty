import React, { useState, useEffect } from 'react';
import { Bot, MessageSquare, Copy, CheckCircle, Smartphone, RefreshCw } from 'lucide-react';
import api from '../api/client';
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
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string>('');
  const [copied, setCopied] = useState(false);

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

  const copyCommand = () => {
    navigator.clipboard.writeText(`/bind ${pin}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          Telegram 机器人
        </span>
      }
      description="绑定后可用一句话通过 Telegram 记账"
    >
      <div className="space-y-5">
        {/* Status */}
        <div className="flex items-center justify-between p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] border border-[var(--color-border)]">
          <span className="text-xs text-[var(--color-text-muted)]">连接状态</span>
          {status?.connected ? (
            <Badge tone="success" dot>
              <CheckCircle size={12} /> 已连接
            </Badge>
          ) : (
            <Badge tone="neutral" dot>未绑定</Badge>
          )}
        </div>

        {!pin && !status?.connected && (
          <>
            <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
              通过 Telegram 发送消息即可快速记账。例如发送
              <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--color-surface-muted)] font-mono text-xs">咖啡 15</code>
              就会自动记录一笔支出。
            </p>
            <Button
              fullWidth
              loading={loading}
              leftIcon={<Smartphone size={16} />}
              onClick={generatePin}
            >
              生成绑定 PIN
            </Button>
          </>
        )}

        {pin && (
          <div className="space-y-4 animate-slide-up">
            <div className="p-5 rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)] border border-[var(--color-brand)]/20 text-center">
              <p className="text-[11px] text-[var(--color-brand)] uppercase tracking-widest mb-2">你的绑定 PIN</p>
              <div className="text-3xl font-mono font-semibold text-[var(--color-brand)] tracking-[0.4em]">{pin}</div>
              <p className="text-[11px] text-[var(--color-text-subtle)] mt-2">5 分钟内有效</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">下一步：将 PIN 发送给机器人</p>
              <div className="flex gap-2">
                <a
                  href={tgUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm flex items-center justify-center gap-1.5 hover:bg-[var(--color-surface-muted)] transition-colors"
                >
                  <MessageSquare size={14} />
                  {botUsername ? `@${botUsername}` : '打开 Telegram'}
                </a>
                <button
                  onClick={copyCommand}
                  className="h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm flex items-center gap-1.5 hover:bg-[var(--color-surface-muted)] transition-colors"
                  title="复制 /bind 命令"
                >
                  {copied ? (
                    <>
                      <CheckCircle size={14} className="text-[var(--color-success)]" /> 已复制
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> 复制命令
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-[var(--color-text-subtle)]">
                粘贴发送 <code className="px-1 py-0.5 rounded bg-[var(--color-surface-muted)] font-mono">/bind {pin}</code> 即可完成绑定
              </p>
            </div>

            <Button variant="ghost" fullWidth leftIcon={<RefreshCw size={14} />} onClick={generatePin} loading={loading}>
              重新生成 PIN
            </Button>
          </div>
        )}

        {status?.connected && (
          <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-success-soft)] border border-[var(--color-success)]/20 space-y-2">
            <p className="text-sm font-medium text-[var(--color-success)]">账号已绑定</p>
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              你现在可以向机器人发送消息记账，例如：
              <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--color-surface)] font-mono text-[var(--color-brand)]">咖啡 15</code>
              或
              <code className="mx-1 px-1.5 py-0.5 rounded bg-[var(--color-surface)] font-mono text-[var(--color-brand)]">晚餐 50 聚餐</code>
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default BotIntegrationModal;
