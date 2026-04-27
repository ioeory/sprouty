import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, User, Mail, ArrowRight, UserCircle, Sprout } from 'lucide-react';
import api from '../api/client';
import { Button, Input } from '../components/ui';

export default function Register() {
  const { t } = useTranslation(['auth', 'common']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await api.get('/auth/registration-status');
        if (!cancel) setRegistrationOpen(res.data.registration_open);
      } catch {
        // Must match Login.tsx: on network/API errors assume open so first deploy
        // still shows the form. Real closed state is enforced by POST /register.
        if (!cancel) setRegistrationOpen(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/register', { username, password, nickname, email });
      navigate('/login');
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth:registerFailed'));
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
          <span className="font-semibold text-[var(--color-text)]">{t('common:appName')}</span>
        </div>

        <div className="space-y-6 relative z-10">
          <h1 className="text-3xl font-bold text-[var(--color-text)] leading-tight">
            {t('auth:registerHeroLine1')}
            <br />
            {t('auth:registerHeroLine2')}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm leading-relaxed">
            {t('auth:registerHeroSubtitle')}
          </p>
          <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
            {[t('auth:registerBullet1'), t('auth:registerBullet2'), t('auth:registerBullet3')].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-[var(--color-text-subtle)] relative z-10">
          {t('auth:registerFooter', { year: new Date().getFullYear() })}
        </p>

        <div className="absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-[var(--color-brand)]/8 blur-3xl" />
      </aside>

      <main className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="md:hidden flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
              <Sprout size={18} />
            </div>
            <span className="font-semibold text-[var(--color-text)]">{t('common:appName')}</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold text-[var(--color-text)]">{t('auth:createAccount')}</h2>
            <p className="text-sm text-[var(--color-text-muted)]">{t('auth:registerSubtitle')}</p>
          </div>

          {error && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}

          {registrationOpen === false && (
            <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-sm text-[var(--color-text-muted)] space-y-3">
              <p>{t('auth:registerClosedBox')}</p>
              <Link to="/login" className="text-[var(--color-brand)] font-medium hover:underline">
                {t('auth:backToLogin')}
              </Link>
            </div>
          )}

          {registrationOpen !== false && (
          <form onSubmit={handleRegister} className="space-y-3.5">
            <Input
              label={t('auth:nickname')}
              leftIcon={<UserCircle size={15} />}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t('auth:nicknamePlaceholder')}
              required
            />
            <Input
              label={t('auth:username')}
              leftIcon={<User size={15} />}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth:usernameUniqueHint')}
              autoComplete="username"
              required
            />
            <Input
              label={t('auth:emailOptional')}
              type="email"
              leftIcon={<Mail size={15} />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              autoComplete="email"
            />
            <Input
              label={t('auth:password')}
              type="password"
              leftIcon={<Lock size={15} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth:passwordMin')}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <Button type="submit" loading={loading} fullWidth rightIcon={<ArrowRight size={16} />} className="mt-2">
              {t('auth:register')}
            </Button>
          </form>
          )}

          <p className="text-center text-xs text-[var(--color-text-muted)]">
            {t('auth:haveAccount')}{' '}
            <Link to="/login" className="text-[var(--color-brand)] hover:underline font-medium">
              {t('auth:loginDirect')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
