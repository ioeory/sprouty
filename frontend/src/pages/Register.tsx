import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, User, Mail, ArrowRight, UserCircle, Sprout } from 'lucide-react';
import api from '../api/client';
import { Button, Input } from '../components/ui';

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/register', { username, password, nickname, email });
      navigate('/login');
    } catch (err: any) {
      setError(err.response?.data?.error || '注册失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-[var(--color-bg)]">
      <aside className="hidden md:flex flex-col justify-between p-10 relative overflow-hidden bg-gradient-to-br from-[var(--color-brand-softer)] to-[var(--color-surface-muted)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
            <Sprout size={18} />
          </div>
          <span className="font-semibold text-[var(--color-text)]">Sprouty</span>
        </div>

        <div className="space-y-6 relative z-10">
          <h1 className="text-3xl font-bold text-[var(--color-text)] leading-tight">
            三分钟建好账本，<br />从今天开始记账
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm leading-relaxed">
            注册即自动创建"我的账本"，并预置餐饮、交通、购物等常用分类，无需额外配置。
          </p>
          <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
            {['即时预算追踪', '家庭成员共享账本', '通过 Telegram 一句话记账'].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-[var(--color-text-subtle)] relative z-10">
          © {new Date().getFullYear()} Sprouty · 自托管
        </p>

        <div className="absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-[var(--color-brand)]/8 blur-3xl" />
      </aside>

      <main className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="md:hidden flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
              <Sprout size={18} />
            </div>
            <span className="font-semibold text-[var(--color-text)]">Sprouty</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold text-[var(--color-text)]">创建账号</h2>
            <p className="text-sm text-[var(--color-text-muted)]">开始使用 Sprouty 自托管记账</p>
          </div>

          {error && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-3.5">
            <Input
              label="昵称"
              leftIcon={<UserCircle size={15} />}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="例如：我家账本"
              required
            />
            <Input
              label="用户名"
              leftIcon={<User size={15} />}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用于登录的唯一用户名"
              autoComplete="username"
              required
            />
            <Input
              label="邮箱（可选）"
              type="email"
              leftIcon={<Mail size={15} />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              autoComplete="email"
            />
            <Input
              label="密码"
              type="password"
              leftIcon={<Lock size={15} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <Button type="submit" loading={loading} fullWidth rightIcon={<ArrowRight size={16} />} className="mt-2">
              注册
            </Button>
          </form>

          <p className="text-center text-xs text-[var(--color-text-muted)]">
            已有账号？{' '}
            <Link to="/login" className="text-[var(--color-brand)] hover:underline font-medium">
              直接登录
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
