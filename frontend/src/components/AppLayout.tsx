import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate, useMatch } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  Tags,
  Users,
  FolderKanban,
  Settings as SettingsIcon,
  LogOut,
  KeyRound,
  Sprout,
  ChevronDown,
  Plus,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Sidebar, type NavItem, Button, ThemeToggle, Modal, Input, cn } from './ui';
import BotIntegrationModal from './BotIntegrationModal';
import AddRecordModal from './AddRecordModal';
import AppearancePopover from './AppearancePopover';
import api from '../api/client';
import i18n, { setAppLocale } from '../i18n';

export interface LedgerLinkedPersonal {
  id: string;
  name: string;
}

export interface Ledger {
  id: string;
  name: string;
  type: string;
  owner_id?: string;
  member_count?: number;
  /** Fallback ledger_total when no month-specific budget row exists */
  default_monthly_budget?: number;
  /** Present on family ledgers: personal sub-ledgers linked under this home book */
  linked_personal?: LedgerLinkedPersonal[];
  /** Total linked personal books for this family (all members); may exceed linked_personal length */
  linked_personal_count?: number;
  /** When this personal ledger is linked to a family, the parent family ledger id */
  parent_family_id?: string;
}

interface LayoutContext {
  currentLedger: Ledger | null;
  ledgers: Ledger[];
  setCurrentLedger: (l: Ledger) => void;
  refreshLedgers: () => Promise<void>;
  openAddRecord: () => void;
  user: any;
}

const LayoutCtx = React.createContext<LayoutContext | null>(null);

export function useLayout() {
  const ctx = React.useContext(LayoutCtx);
  if (!ctx) throw new Error('useLayout must be used inside AppLayout');
  return ctx;
}

const SIDEBAR_COLLAPSED_KEY = 'sprouts_sidebar_collapsed';

export default function AppLayout() {
  const { t } = useTranslation(['nav', 'common', 'ledger']);
  const navigate = useNavigate();
  const projectRouteMatch = useMatch('/projects/:id');
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [currentLedger, setCurrentLedgerState] = useState<Ledger | null>(null);
  const [user, setUser] = useState<any>(null);
  const [showBot, setShowBot] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  /** When opening FAB from a project detail URL, use budget/home ledger + default project */
  const [fabAddLedgerId, setFabAddLedgerId] = useState<string | null>(null);
  const [fabAddProjectId, setFabAddProjectId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameLedgerType, setRenameLedgerType] = useState<'personal' | 'family'>('personal');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameErr, setRenameErr] = useState('');
  const [ledgerDeleteOpen, setLedgerDeleteOpen] = useState(false);
  const [ledgerDeleteInput, setLedgerDeleteInput] = useState('');
  const [ledgerDeleteLoading, setLedgerDeleteLoading] = useState(false);
  const [ledgerDeleteErr, setLedgerDeleteErr] = useState('');
  const [renameDefaultBudget, setRenameDefaultBudget] = useState('');
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdCurrent, setPwdCurrent] = useState('');
  const [pwdNew, setPwdNew] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdErr, setPwdErr] = useState('');
  const [pwdOk, setPwdOk] = useState(false);

  const openAddRecordFromFab = React.useCallback(() => {
    if (!currentLedger) return;
    const pid = projectRouteMatch?.params?.id;
    if (!pid) {
      setFabAddLedgerId(null);
      setFabAddProjectId(null);
      setShowAdd(true);
      return;
    }
    void (async () => {
      try {
        const { data } = await api.get(`/projects/${pid}/summary`);
        const proj = data.project as {
          ledger_id: string;
          budget?: { mode: string; ledger_id?: string };
        };
        const lid =
          proj.budget?.mode !== 'none' && proj.budget?.ledger_id ? proj.budget.ledger_id : proj.ledger_id;
        setFabAddLedgerId(lid || null);
        setFabAddProjectId(pid);
        setShowAdd(true);
      } catch {
        setFabAddLedgerId(null);
        setFabAddProjectId(null);
        setShowAdd(true);
      }
    })();
  }, [currentLedger, projectRouteMatch?.params?.id]);

  const persistAppLocale = React.useCallback(async (lng: 'zh-CN' | 'en') => {
    setAppLocale(lng);
    if (!localStorage.getItem('sprouts_token')) return;
    const preferred_locale = lng === 'en' ? 'en' : 'zh-CN';
    try {
      await api.put('/user/locale', { preferred_locale });
      const raw = localStorage.getItem('sprouts_user');
      if (raw) {
        const u = JSON.parse(raw) as Record<string, unknown>;
        u.preferred_locale = preferred_locale;
        localStorage.setItem('sprouts_user', JSON.stringify(u));
      }
    } catch {
      /* ignore network errors */
    }
  }, []);

  const navItems: NavItem[] = React.useMemo(() => {
    const base: NavItem[] = [
      { to: '/', label: t('nav:dashboard'), icon: <LayoutDashboard size={16} /> },
      { to: '/transactions', label: t('nav:transactions'), icon: <Receipt size={16} /> },
      { to: '/projects', label: t('nav:projects'), icon: <FolderKanban size={16} /> },
      { to: '/categories', label: t('nav:categories'), icon: <Tags size={16} /> },
      { to: '/members', label: t('nav:members'), icon: <Users size={16} /> },
    ];
    if (user?.role === 'admin') {
      return [...base, { to: '/admin', label: t('nav:admin'), icon: <Shield size={16} /> }];
    }
    return base;
  }, [user?.role, t]);

  useEffect(() => {
    const raw = localStorage.getItem('sprouts_user');
    if (raw) {
      const u = JSON.parse(raw) as { preferred_locale?: string };
      setUser(u);
      const pl = u?.preferred_locale;
      if (pl === 'en' || pl === 'zh-CN') {
        setAppLocale(pl === 'en' ? 'en' : 'zh-CN');
      }
    }
    refreshLedgers();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  const rootLedgers = React.useMemo(
    () => ledgers.filter((l) => !l.parent_family_id),
    [ledgers],
  );

  const refreshLedgers = async () => {
    try {
      const res = await api.get('/ledgers');
      setLedgers(res.data || []);
      const storedId = localStorage.getItem('sprouts_ledger_id');
      const list = res.data || [];
      const match = list.find((l: Ledger) => l.id === storedId);
      if (match) {
        setCurrentLedgerState(match);
      } else if (list.length) {
        setCurrentLedgerState(list[0]);
        localStorage.setItem('sprouts_ledger_id', list[0].id);
      } else {
        setCurrentLedgerState(null);
        localStorage.removeItem('sprouts_ledger_id');
      }
    } catch (err) {
      console.error('Failed to fetch ledgers', err);
    }
  };

  const setCurrentLedger = (l: Ledger) => {
    setCurrentLedgerState(l);
    localStorage.setItem('sprouts_ledger_id', l.id);
  };

  const handleLogout = () => {
    localStorage.removeItem('sprouts_token');
    localStorage.removeItem('sprouts_user');
    localStorage.removeItem('sprouts_ledger_id');
    navigate('/login');
  };

  const userInitial = (user?.nickname || user?.username || 'U')[0].toUpperCase();

  const brandFull = (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center shrink-0">
        <Sprout size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--color-text)] leading-tight truncate">{t('common:appName')}</p>
        <p className="text-[11px] text-[var(--color-text-subtle)] leading-tight">{t('common:appTagline')}</p>
      </div>
    </div>
  );

  const brandCollapsed = (
    <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-brand)] text-white flex items-center justify-center">
      <Sprout size={16} />
    </div>
  );

  const footerFull = (
    <button
      onClick={() => setShowBot(true)}
      className="w-full flex items-center gap-2.5 px-3 h-9 rounded-[var(--radius-md)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] transition-colors"
    >
      <SettingsIcon size={16} />
      <span className="flex-1 text-left">{t('nav:telegramBot')}</span>
    </button>
  );

  const footerCollapsed = (
    <button
      onClick={() => setShowBot(true)}
      title={t('nav:telegramBot')}
      className="w-full flex items-center justify-center h-9 rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] transition-colors"
    >
      <SettingsIcon size={16} />
    </button>
  );

  return (
    <LayoutCtx.Provider
      value={{
        currentLedger,
        ledgers,
        setCurrentLedger,
        refreshLedgers,
        openAddRecord: openAddRecordFromFab,
        user,
      }}
    >
      <div className="flex min-h-screen bg-[var(--color-bg)]">
        <Sidebar
          brand={brandFull}
          brandCollapsed={brandCollapsed}
          items={navItems}
          footer={footerFull}
          footerCollapsed={footerCollapsed}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 sm:px-4 md:px-6 flex items-center justify-between gap-1.5 sm:gap-3 sticky top-0 z-20">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 pr-1">
              {/* Mobile hamburger */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                aria-label={t('common:openSidebar')}
              >
                <Menu size={16} />
              </button>

              {/* Desktop collapse toggle */}
              <button
                onClick={() => setSidebarCollapsed((v) => !v)}
                className="hidden lg:flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                aria-label={sidebarCollapsed ? t('common:expandSidebar') : t('common:collapseSidebar')}
                title={sidebarCollapsed ? t('common:expandSidebar') : t('common:collapseSidebar')}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>

              {/* Ledger picker */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 sm:gap-2 h-9 min-w-0 max-w-full pl-2 pr-2 sm:px-3 rounded-[var(--radius-md)] text-sm border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text)] transition-colors"
                >
                  <span className="font-medium truncate max-w-[min(7.5rem,28vw)] sm:max-w-[140px]">
                    {currentLedger?.name || t('common:selectLedger')}
                  </span>
                  <ChevronDown size={14} className="text-[var(--color-text-subtle)] shrink-0" />
                </button>
                {currentLedger && user?.id && currentLedger.owner_id === user.id && (
                  <button
                    type="button"
                    title={t('common:ledgerSettings')}
                    onClick={() => {
                      setRenameValue(currentLedger.name);
                      setRenameLedgerType(currentLedger.type === 'family' ? 'family' : 'personal');
                      setRenameDefaultBudget(
                        currentLedger.default_monthly_budget != null
                          ? String(currentLedger.default_monthly_budget)
                          : '',
                      );
                      setRenameErr('');
                      setRenameOpen(true);
                    }}
                    className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-20 min-w-[240px] max-h-[min(70vh,420px)] overflow-y-auto rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg py-1">
                      {rootLedgers.map((l) => (
                        <React.Fragment key={l.id}>
                          <button
                            onClick={() => {
                              setCurrentLedger(l);
                              setMenuOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-[var(--color-surface-muted)] ${
                              currentLedger?.id === l.id ? 'text-[var(--color-brand)] font-medium' : 'text-[var(--color-text)]'
                            }`}
                          >
                            <span className="truncate">{l.name}</span>
                            <span className="text-[10px] text-[var(--color-text-subtle)] ml-3 shrink-0">
                              {l.type === 'family'
                                ? t('ledger:familyBadge', { count: l.member_count ?? '?' })
                                : t('ledger:personalBadge', { count: l.member_count ?? 1 })}
                            </span>
                          </button>
                          {l.type === 'family' &&
                            (l.linked_personal || []).map((sub) => {
                              const full = ledgers.find((x) => x.id === sub.id);
                              if (!full) return null;
                              const active = currentLedger?.id === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  onClick={() => {
                                    setCurrentLedger(full);
                                    setMenuOpen(false);
                                  }}
                                  className={`w-full text-left pl-6 pr-3 py-1.5 text-xs flex items-center justify-between hover:bg-[var(--color-surface-muted)] ${
                                    active ? 'text-[var(--color-brand)] font-medium' : 'text-[var(--color-text-muted)]'
                                  }`}
                                >
                                  <span className="truncate">
                                    <span className="text-[var(--color-text-subtle)] mr-1">└</span>
                                    {t('ledger:subLedger', { name: sub.name })}
                                  </span>
                                </button>
                              );
                            })}
                        </React.Fragment>
                      ))}
                      {!rootLedgers.length && (
                        <p className="px-3 py-4 text-xs text-[var(--color-text-subtle)]">{t('ledger:noLedgers')}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <div className="hidden md:flex items-center gap-1">
                <AppearancePopover />
                <ThemeToggle compact />
              </div>
              <div
                className="flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shrink-0"
                role="group"
                aria-label={t('common:language')}
              >
                <button
                  type="button"
                  onClick={() => void persistAppLocale('zh-CN')}
                  className={cn(
                    'px-1.5 py-1 rounded-[var(--radius-sm)] text-[10px] font-medium transition-colors',
                    (i18n.language || '').startsWith('zh')
                      ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]',
                  )}
                >
                  {t('common:lang_zh')}
                </button>
                <button
                  type="button"
                  onClick={() => void persistAppLocale('en')}
                  className={cn(
                    'px-1.5 py-1 rounded-[var(--radius-sm)] text-[10px] font-medium transition-colors',
                    (i18n.language || '').startsWith('en')
                      ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]',
                  )}
                >
                  {t('common:lang_en')}
                </button>
              </div>
              <Button
                size="sm"
                type="button"
                title={t('common:record')}
                aria-label={t('common:record')}
                leftIcon={<Plus size={18} strokeWidth={2.25} className="sm:size-[14px]" />}
                onClick={() => openAddRecordFromFab()}
                disabled={!currentLedger}
                className="shrink-0 max-sm:h-9 max-sm:w-9 max-sm:min-w-9 max-sm:px-0 max-sm:gap-0 max-sm:justify-center"
              >
                <span className="hidden sm:inline">{t('common:record')}</span>
              </Button>
              <div className="flex items-center gap-1 sm:gap-2 pl-1.5 sm:pl-2 ml-0.5 sm:ml-1 border-l border-[var(--color-border)]">
                <div className="w-8 h-8 rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center text-xs font-semibold">
                  {userInitial}
                </div>
                <div className="hidden md:block">
                  <p className="text-xs font-medium text-[var(--color-text)] leading-tight">
                    {user?.nickname || user?.username}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-subtle)] leading-tight">{t('common:loggedIn')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPwdErr('');
                    setPwdOk(false);
                    setPwdCurrent('');
                    setPwdNew('');
                    setPwdConfirm('');
                    setPwdOpen(true);
                  }}
                  title={t('common:changePassword')}
                  className="ml-0.5 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                  <KeyRound size={14} />
                </button>
                <button
                  onClick={handleLogout}
                  title={t('common:logout')}
                  className="ml-1 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] transition-colors"
                >
                  <LogOut size={14} />
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 min-w-0 p-4 md:p-6 max-w-[1400px] w-full mx-auto">
            <Outlet />
          </main>
        </div>

        {renameOpen && currentLedger && (
          <Modal
            open={renameOpen}
            onClose={() => !renameSaving && setRenameOpen(false)}
            title={t('common:ledgerSettings')}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={renameSaving} onClick={() => setRenameOpen(false)}>
                  {t('common:cancel')}
                </Button>
                <Button
                  size="sm"
                  loading={renameSaving}
                  onClick={async () => {
                    const name = renameValue.trim();
                    if (!name) {
                      setRenameErr(t('common:nameRequired'));
                      return;
                    }
                    setRenameSaving(true);
                    setRenameErr('');
                    try {
                      const raw = renameDefaultBudget.trim();
                      const body: Record<string, unknown> = { name, type: renameLedgerType };
                      if (raw === '') {
                        body.clear_default_monthly_budget = true;
                      } else {
                        const n = parseFloat(raw);
                        if (Number.isNaN(n) || n < 0) {
                          setRenameErr(t('ledger:defaultBudgetInvalid'));
                          setRenameSaving(false);
                          return;
                        }
                        body.default_monthly_budget = n;
                        body.clear_default_monthly_budget = false;
                      }
                      await api.put(`/ledgers/${currentLedger.id}`, body);
                      await refreshLedgers();
                      setRenameOpen(false);
                    } catch (e: any) {
                      setRenameErr(e.response?.data?.error || t('common:saveFailed'));
                    } finally {
                      setRenameSaving(false);
                    }
                  }}
                >
                  {t('common:save')}
                </Button>
              </div>
            }
          >
            {renameErr && (
              <p className="text-xs text-[var(--color-danger)] mb-2">{renameErr}</p>
            )}
            <div className="space-y-4">
              <Input label={t('common:ledgerName')} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
              <div>
                <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">{t('common:ledgerTypeLabel')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['personal', 'family'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setRenameLedgerType(kind)}
                      className={cn(
                        'h-10 rounded-[var(--radius-md)] border text-sm font-medium transition-all',
                        renameLedgerType === kind
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]',
                      )}
                    >
                      {kind === 'personal' ? t('common:ledgerTypePersonal') : t('common:ledgerTypeFamily')}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--color-text-subtle)] mt-2 leading-relaxed">{t('common:ledgerTypeModalHint')}</p>
              </div>
              <Input
                label={t('ledger:defaultBudgetLabel')}
                value={renameDefaultBudget}
                onChange={(e) => setRenameDefaultBudget(e.target.value)}
                placeholder="0"
                type="number"
                min={0}
                step={100}
              />
              <p className="text-[11px] text-[var(--color-text-subtle)] leading-relaxed">{t('ledger:defaultBudgetHint')}</p>
              <div className="pt-4 mt-4 border-t border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mb-3">{t('ledger:deleteLedgerWarning')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leftIcon={<Trash2 size={14} />}
                  className="border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                  onClick={() => {
                    setLedgerDeleteErr('');
                    setLedgerDeleteInput('');
                    setLedgerDeleteOpen(true);
                  }}
                >
                  {t('ledger:deleteLedger')}
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {ledgerDeleteOpen && currentLedger && (
          <Modal
            open={ledgerDeleteOpen}
            onClose={() => !ledgerDeleteLoading && setLedgerDeleteOpen(false)}
            title={t('ledger:deleteLedgerTitle')}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={ledgerDeleteLoading} onClick={() => setLedgerDeleteOpen(false)}>
                  {t('common:cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={ledgerDeleteLoading}
                  disabled={
                    ledgerDeleteInput.trim() !== currentLedger.name.trim() || ledgerDeleteLoading
                  }
                  onClick={async () => {
                    if (ledgerDeleteInput.trim() !== currentLedger.name.trim()) return;
                    setLedgerDeleteLoading(true);
                    setLedgerDeleteErr('');
                    try {
                      await api.delete(`/ledgers/${currentLedger.id}`);
                      setLedgerDeleteOpen(false);
                      setRenameOpen(false);
                      setLedgerDeleteInput('');
                      await refreshLedgers();
                      navigate('/');
                    } catch (e: unknown) {
                      const msg =
                        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                        t('common:saveFailed');
                      setLedgerDeleteErr(msg);
                    } finally {
                      setLedgerDeleteLoading(false);
                    }
                  }}
                >
                  {t('ledger:deleteLedgerButton')}
                </Button>
              </div>
            }
          >
            {ledgerDeleteErr && (
              <p className="text-xs text-[var(--color-danger)] mb-3">{ledgerDeleteErr}</p>
            )}
            <p className="text-sm text-[var(--color-text)] mb-3">{t('ledger:deleteLedgerTypeName', { name: currentLedger.name })}</p>
            <Input
              value={ledgerDeleteInput}
              onChange={(e) => setLedgerDeleteInput(e.target.value)}
              placeholder={t('ledger:deleteLedgerConfirmPlaceholder')}
              autoComplete="off"
              aria-invalid={
                ledgerDeleteInput.length > 0 && ledgerDeleteInput.trim() !== currentLedger.name.trim()
              }
            />
            {ledgerDeleteInput.length > 0 && ledgerDeleteInput.trim() !== currentLedger.name.trim() && (
              <p className="text-[11px] text-[var(--color-danger)] mt-2">{t('ledger:deleteLedgerMismatch')}</p>
            )}
          </Modal>
        )}

        {pwdOpen && (
          <Modal
            open={pwdOpen}
            onClose={() => !pwdSaving && setPwdOpen(false)}
            title={t('common:changePasswordTitle')}
            description={t('common:changePasswordHint')}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={pwdSaving} onClick={() => setPwdOpen(false)}>
                  {t('common:cancel')}
                </Button>
                <Button
                  size="sm"
                  loading={pwdSaving}
                  onClick={async () => {
                    setPwdErr('');
                    setPwdOk(false);
                    if (pwdNew.length < 6) {
                      setPwdErr(t('common:passwordTooShort'));
                      return;
                    }
                    if (pwdNew !== pwdConfirm) {
                      setPwdErr(t('common:passwordMismatch'));
                      return;
                    }
                    setPwdSaving(true);
                    try {
                      const body: Record<string, string> = { new_password: pwdNew };
                      if (pwdCurrent.trim()) body.current_password = pwdCurrent.trim();
                      await api.put('/user/password', body);
                      setPwdOk(true);
                      setPwdCurrent('');
                      setPwdNew('');
                      setPwdConfirm('');
                      setTimeout(() => setPwdOpen(false), 1200);
                    } catch (e: any) {
                      setPwdErr(e.response?.data?.error || t('common:saveFailed'));
                    } finally {
                      setPwdSaving(false);
                    }
                  }}
                >
                  {t('common:save')}
                </Button>
              </div>
            }
          >
            {pwdOk && (
              <p className="text-xs text-[var(--color-brand)] mb-3">{t('common:passwordChanged')}</p>
            )}
            {pwdErr && <p className="text-xs text-[var(--color-danger)] mb-3">{pwdErr}</p>}
            <div className="space-y-3">
              <Input
                label={t('common:currentPassword')}
                type="password"
                autoComplete="current-password"
                value={pwdCurrent}
                onChange={(e) => setPwdCurrent(e.target.value)}
              />
              <Input
                label={t('common:newPassword')}
                type="password"
                autoComplete="new-password"
                value={pwdNew}
                onChange={(e) => setPwdNew(e.target.value)}
                placeholder={t('common:passwordMinHint')}
              />
              <Input
                label={t('common:confirmPassword')}
                type="password"
                autoComplete="new-password"
                value={pwdConfirm}
                onChange={(e) => setPwdConfirm(e.target.value)}
              />
            </div>
          </Modal>
        )}

        {showBot && <BotIntegrationModal open onClose={() => setShowBot(false)} />}
        {showAdd && currentLedger && (
          <AddRecordModal
            open
            ledgerId={fabAddLedgerId ?? currentLedger.id}
            defaultProjectId={fabAddProjectId ?? undefined}
            splitTargets={(() => {
              const targetId = fabAddLedgerId ?? currentLedger.id;
              const led = ledgers.find((l) => l.id === targetId) ?? currentLedger;
              return led.type === 'family' ? led.linked_personal ?? [] : [];
            })()}
            onClose={() => {
              setShowAdd(false);
              setFabAddLedgerId(null);
              setFabAddProjectId(null);
            }}
            onSuccess={() => {
              setShowAdd(false);
              setFabAddLedgerId(null);
              setFabAddProjectId(null);
              window.dispatchEvent(new CustomEvent('sprouts:refresh'));
            }}
          />
        )}
      </div>
    </LayoutCtx.Provider>
  );
}
