import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, User, ArrowRight, Sprout, Leaf, PiggyBank, Users } from 'lucide-react';
import api from '../api/client';
import { Button, Input } from '../components/ui';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await api.post('/auth/login', { username, password });
      localStorage.setItem('sprouts_token', response.data.token);
      localStorage.setItem('sprouts_user', JSON.stringify(response.data.user));
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || '登录失败，请检查用户名和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-[var(--color-bg)]">
      {/* Left brand pane */}
      <aside className="hidden md:flex flex-col justify-between p-10 relative overflow-hidden bg-gradient-to-br from-[var(--color-brand-softer)] to-[var(--color-surface-muted)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
            <Sprout size={18} />
          </div>
          <span className="font-semibold text-[var(--color-text)]">Sprouty</span>
        </div>

        <div className="space-y-6 relative z-10">
          <h1 className="text-3xl font-bold text-[var(--color-text)] leading-tight">
            记好每一笔账，<br />守好每一份家
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm leading-relaxed">
            极简的自托管家庭账本，支持多账本切换、预算追踪、家庭共享与 Telegram 机器人记账。
          </p>
          <div className="grid grid-cols-3 gap-3 pt-4">
            {[
              { icon: <Leaf size={16} />, label: '极简体验' },
              { icon: <PiggyBank size={16} />, label: '预算管理' },
              { icon: <Users size={16} />, label: '家庭共享' },
            ].map((f) => (
              <div
                key={f.label}
                className="px-3 py-3 rounded-[var(--radius-md)] bg-[var(--color-surface)]/70 border border-[var(--color-border)] flex flex-col gap-1.5 items-start"
              >
                <span className="text-[var(--color-brand)]">{f.icon}</span>
                <span className="text-xs font-medium text-[var(--color-text)]">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-[var(--color-text-subtle)] relative z-10">
          © {new Date().getFullYear()} Sprouty · 自托管 · 数据留在你手中
        </p>

        {/* Decorative blob */}
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-[var(--color-brand)]/8 blur-3xl" />
      </aside>

      {/* Right form */}
      <main className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm space-y-8">
          <div className="md:hidden flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
              <Sprout size={18} />
            </div>
            <span className="font-semibold text-[var(--color-text)]">Sprouty</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold text-[var(--color-text)]">欢迎回来</h2>
            <p className="text-sm text-[var(--color-text-muted)]">登录后继续管理你的账本</p>
          </div>

          {error && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              label="用户名"
              leftIcon={<User size={15} />}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入你的用户名"
              autoComplete="username"
              required
            />
            <Input
              label="密码"
              type="password"
              leftIcon={<Lock size={15} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
            <Button type="submit" loading={loading} fullWidth rightIcon={<ArrowRight size={16} />}>
              登录
            </Button>
          </form>

          <p className="text-center text-xs text-[var(--color-text-muted)]">
            还没有账号？{' '}
            <Link to="/register" className="text-[var(--color-brand)] hover:underline font-medium">
              立即注册
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
