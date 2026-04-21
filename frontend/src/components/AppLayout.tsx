import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  Tags,
  Users,
  FolderKanban,
  Settings as SettingsIcon,
  LogOut,
  Sprout,
  ChevronDown,
  Plus,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Sidebar, type NavItem, Button, ThemeToggle } from './ui';
import BotIntegrationModal from './BotIntegrationModal';
import AddRecordModal from './AddRecordModal';
import api from '../api/client';

export interface Ledger {
  id: string;
  name: string;
  type: string;
  owner_id?: string;
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

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '仪表盘', icon: <LayoutDashboard size={16} /> },
  { to: '/transactions', label: '流水记录', icon: <Receipt size={16} /> },
  { to: '/projects', label: '项目预算', icon: <FolderKanban size={16} /> },
  { to: '/categories', label: '分类管理', icon: <Tags size={16} /> },
  { to: '/members', label: '成员共享', icon: <Users size={16} /> },
];

const SIDEBAR_COLLAPSED_KEY = 'sprouts_sidebar_collapsed';

export default function AppLayout() {
  const navigate = useNavigate();
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [currentLedger, setCurrentLedgerState] = useState<Ledger | null>(null);
  const [user, setUser] = useState<any>(null);
  const [showBot, setShowBot] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });

  useEffect(() => {
    const raw = localStorage.getItem('sprouts_user');
    if (raw) setUser(JSON.parse(raw));
    refreshLedgers();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  const refreshLedgers = async () => {
    try {
      const res = await api.get('/ledgers');
      setLedgers(res.data || []);
      const storedId = localStorage.getItem('sprouts_ledger_id');
      const match = (res.data || []).find((l: Ledger) => l.id === storedId);
      if (match) {
        setCurrentLedgerState(match);
      } else if (res.data?.length) {
        setCurrentLedgerState(res.data[0]);
        localStorage.setItem('sprouts_ledger_id', res.data[0].id);
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
        <p className="text-sm font-semibold text-[var(--color-text)] leading-tight truncate">Sprouty</p>
        <p className="text-[11px] text-[var(--color-text-subtle)] leading-tight">萌记・家庭账本</p>
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
      <span className="flex-1 text-left">Telegram Bot</span>
    </button>
  );

  const footerCollapsed = (
    <button
      onClick={() => setShowBot(true)}
      title="Telegram Bot"
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
        openAddRecord: () => setShowAdd(true),
        user,
      }}
    >
      <div className="flex min-h-screen bg-[var(--color-bg)]">
        <Sidebar
          brand={brandFull}
          brandCollapsed={brandCollapsed}
          items={NAV_ITEMS}
          footer={footerFull}
          footerCollapsed={footerCollapsed}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 md:px-6 flex items-center justify-between gap-3 sticky top-0 z-20">
            <div className="flex items-center gap-2 min-w-0">
              {/* Mobile hamburger */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                aria-label="打开侧边栏"
              >
                <Menu size={16} />
              </button>

              {/* Desktop collapse toggle */}
              <button
                onClick={() => setSidebarCollapsed((v) => !v)}
                className="hidden lg:flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>

              {/* Ledger picker */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex items-center gap-2 h-9 px-3 rounded-[var(--radius-md)] text-sm border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text)] transition-colors"
                >
                  <span className="font-medium truncate max-w-[140px]">
                    {currentLedger?.name || '选择账本'}
                  </span>
                  <ChevronDown size={14} className="text-[var(--color-text-subtle)]" />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-20 min-w-[220px] rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg py-1">
                      {ledgers.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => {
                            setCurrentLedger(l);
                            setMenuOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-[var(--color-surface-muted)] ${
                            currentLedger?.id === l.id ? 'text-[var(--color-brand)] font-medium' : 'text-[var(--color-text)]'
                          }`}
                        >
                          <span className="truncate">{l.name}</span>
                          <span className="text-[10px] text-[var(--color-text-subtle)] uppercase ml-3">
                            {l.type === 'family' ? '共享' : '个人'}
                          </span>
                        </button>
                      ))}
                      {!ledgers.length && (
                        <p className="px-3 py-4 text-xs text-[var(--color-text-subtle)]">暂无账本</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle className="hidden md:inline-flex" compact />
              <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowAdd(true)} disabled={!currentLedger}>
                记一笔
              </Button>
              <div className="flex items-center gap-2 pl-2 ml-1 border-l border-[var(--color-border)]">
                <div className="w-8 h-8 rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center text-xs font-semibold">
                  {userInitial}
                </div>
                <div className="hidden md:block">
                  <p className="text-xs font-medium text-[var(--color-text)] leading-tight">
                    {user?.nickname || user?.username}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-subtle)] leading-tight">已登录</p>
                </div>
                <button
                  onClick={handleLogout}
                  title="退出登录"
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

        {showBot && <BotIntegrationModal open onClose={() => setShowBot(false)} />}
        {showAdd && currentLedger && (
          <AddRecordModal
            open
            ledgerId={currentLedger.id}
            onClose={() => setShowAdd(false)}
            onSuccess={() => {
              setShowAdd(false);
              window.dispatchEvent(new CustomEvent('sprouts:refresh'));
            }}
          />
        )}
      </div>
    </LayoutCtx.Provider>
  );
}
