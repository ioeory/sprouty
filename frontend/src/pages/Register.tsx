import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, User, Mail, ArrowRight, UserCircle, Sprout } from 'lucide-react';
import api from '../api/client';
import { Button, Input } from '../components/ui';
import { AuthLanguageToggle } from '../components/AuthLanguageToggle';

export default function Register() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
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
      setError(err.response?.data?.error || t('registerFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-[var(--color-bg)] relative">
      <div className="absolute top-4 right-4 z-20 md:top-6 md:right-6">
        <AuthLanguageToggle />
      </div>
      <aside className="hidden md:flex flex-col justify-between p-10 relative overflow-hidden bg-gradient-to-br from-[var(--color-brand-softer)] to-[var(--color-surface-muted)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
            <Sprout size={18} />
          </div>
          <span className="font-semibold text-[var(--color-text)]">{tc('appName')}</span>
        </div>

        <div className="space-y-6 relative z-10">
          <h1 className="text-3xl font-bold text-[var(--color-text)] leading-tight">
            {t('registerHeroLine1')}
            <br />
            {t('registerHeroLine2')}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm leading-relaxed">
            {t('registerHeroSubtitle')}
          </p>
          <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
            {[t('registerBullet1'), t('registerBullet2'), t('registerBullet3')].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-[var(--color-text-subtle)] relative z-10">
          {t('registerFooter', { year: new Date().getFullYear() })}
        </p>

        <div className="absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-[var(--color-brand)]/8 blur-3xl" />
      </aside>

      <main className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="md:hidden flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
              <Sprout size={18} />
            </div>
            <span className="font-semibold text-[var(--color-text)]">{tc('appName')}</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold text-[var(--color-text)]">{t('createAccount')}</h2>
            <p className="text-sm text-[var(--color-text-muted)]">{t('registerSubtitle')}</p>
          </div>

          {error && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}

          {registrationOpen === false && (
            <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-sm text-[var(--color-text-muted)] space-y-3">
              <p>{t('registerClosedBox')}</p>
              <Link to="/login" className="text-[var(--color-brand)] font-medium hover:underline">
                {t('backToLogin')}
              </Link>
            </div>
          )}

          {registrationOpen !== false && (
          <form onSubmit={handleRegister} className="space-y-3.5">
            <Input
              label={t('nickname')}
              leftIcon={<UserCircle size={15} />}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t('nicknamePlaceholder')}
              required
            />
            <Input
              label={t('username')}
              leftIcon={<User size={15} />}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('usernameUniqueHint')}
              autoComplete="username"
              required
            />
            <Input
              label={t('emailOptional')}
              type="email"
              leftIcon={<Mail size={15} />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              autoComplete="email"
            />
            <Input
              label={t('password')}
              type="password"
              leftIcon={<Lock size={15} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('passwordMin')}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <Button type="submit" loading={loading} fullWidth rightIcon={<ArrowRight size={16} />} className="mt-2">
              {t('register')}
            </Button>
          </form>
          )}

          <p className="text-center text-xs text-[var(--color-text-muted)]">
            {t('haveAccount')}{' '}
            <Link to="/login" className="text-[var(--color-brand)] hover:underline font-medium">
              {t('loginDirect')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
