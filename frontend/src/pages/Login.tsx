import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Lock, User, ArrowRight, Sprout, Leaf, PiggyBank, Users, KeyRound } from 'lucide-react';
import api from '../api/client';
import { setAppLocale } from '../i18n';
import { apiAuthUrl } from '../lib/apiBase';
import { Button, Input } from '../components/ui';

export default function Login() {
  const { t } = useTranslation(['auth', 'common']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const exchangeStarted = useRef(false);
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [reg, oidc] = await Promise.all([
          api.get('/auth/registration-status'),
          api.get('/auth/oidc/config'),
        ]);
        if (!cancel) {
          setRegistrationOpen(reg.data.registration_open);
          setOidcConfigured(!!oidc.data.configured);
        }
      } catch {
        if (!cancel) setRegistrationOpen(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const code = searchParams.get('exchange');
    if (!code || exchangeStarted.current) return;
    exchangeStarted.current = true;
    let cancelled = false;
    (async () => {
      setExchangeBusy(true);
      setError('');
      try {
        const res = await api.post('/auth/oidc/exchange', { code });
        localStorage.setItem('sprouts_token', res.data.token);
        localStorage.setItem('sprouts_user', JSON.stringify(res.data.user));
        const pl = res.data.user?.preferred_locale;
        if (pl === 'en' || pl === 'zh-CN') {
          setAppLocale(pl === 'en' ? 'en' : 'zh-CN');
        }
        setSearchParams({});
        navigate('/');
      } catch (e: any) {
        exchangeStarted.current = false;
        if (!cancelled) {
          setError(e.response?.data?.error || t('auth:oidcFailed'));
        }
      } finally {
        if (!cancelled) setExchangeBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate, setSearchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await api.post('/auth/login', { username, password });
      localStorage.setItem('sprouts_token', response.data.token);
      localStorage.setItem('sprouts_user', JSON.stringify(response.data.user));
      const pl = response.data.user?.preferred_locale;
      if (pl === 'en' || pl === 'zh-CN') {
        setAppLocale(pl === 'en' ? 'en' : 'zh-CN');
      }
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth:loginFailed'));
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
            {t('auth:heroTitleLine1')}
            <br />
            {t('auth:heroTitleLine2')}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm leading-relaxed">{t('auth:heroSubtitle')}</p>
          <div className="grid grid-cols-3 gap-3 pt-4">
            {[
              { icon: <Leaf size={16} />, label: t('auth:featureMinimal') },
              { icon: <PiggyBank size={16} />, label: t('auth:featureBudget') },
              { icon: <Users size={16} />, label: t('auth:featureFamily') },
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
          {t('auth:footer', { year: new Date().getFullYear() })}
        </p>

        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-[var(--color-brand)]/8 blur-3xl" />
      </aside>

      <main className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm space-y-8">
          <div className="md:hidden flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
              <Sprout size={18} />
            </div>
            <span className="font-semibold text-[var(--color-text)]">{t('common:appName')}</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold text-[var(--color-text)]">{t('auth:welcomeBack')}</h2>
            <p className="text-sm text-[var(--color-text-muted)]">{t('auth:loginSubtitle')}</p>
          </div>

          {exchangeBusy && (
            <p className="text-xs text-[var(--color-text-muted)]">{t('auth:oidcBusy')}</p>
          )}

          {error && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}

          {oidcConfigured && (
            <Button
              type="button"
              variant="outline"
              fullWidth
              leftIcon={<KeyRound size={16} />}
              onClick={() => {
                window.location.href = apiAuthUrl('/auth/oidc/login');
              }}
            >
              {t('auth:oidcLogin')}
            </Button>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              label={t('auth:username')}
              leftIcon={<User size={15} />}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth:usernamePlaceholder')}
              autoComplete="username"
              required
            />
            <Input
              label={t('auth:password')}
              type="password"
              leftIcon={<Lock size={15} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
            <Button type="submit" loading={loading} fullWidth rightIcon={<ArrowRight size={16} />}>
              {t('auth:login')}
            </Button>
          </form>

          {registrationOpen === false ? (
            <p className="text-center text-xs text-[var(--color-text-muted)]">{t('auth:registerClosed')}</p>
          ) : (
            <p className="text-center text-xs text-[var(--color-text-muted)]">
              {t('auth:noAccount')}{' '}
              <Link to="/register" className="text-[var(--color-brand)] hover:underline font-medium">
                {t('auth:registerNow')}
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
