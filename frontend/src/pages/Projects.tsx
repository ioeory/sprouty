import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FolderKanban,
  Wallet,
  Pencil,
  Trash2,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Loader2,
} from 'lucide-react';
import api from '../api/client';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Badge,
  CategoryIcon,
  Modal,
  cn,
} from '../components/ui';
import { useLayout } from '../components/AppLayout';
import ProjectFormModal from '../components/ProjectFormModal';
import ProjectBudgetModal from '../components/ProjectBudgetModal';

interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: string;
  note: string;
  ledger_id: string;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  budget: {
    mode: 'none' | 'total' | 'monthly';
    amount: number;
    year_month?: string;
    ledger_id?: string;
  };
  spent: number;
  spent_total: number;
  remaining: number;
  usage_pct: number;
}

export default function Projects() {
  const { t } = useTranslation(['projects', 'common']);
  const { currentLedger } = useLayout();
  const modeLabel = (m: ProjectSummary['budget']['mode']) =>
    m === 'none' ? t('projects:budgetMode_none') : m === 'total' ? t('projects:budgetMode_total') : t('projects:budgetMode_monthly');
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [budgetEditing, setBudgetEditing] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async (ledgerId: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ ledger_id: ledgerId });
      if (!showArchived) params.set('status', 'active');
      const res = await api.get(`/projects?${params.toString()}`);
      setProjects(res.data || []);
    } catch (err) {
      console.error('Failed to load projects', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentLedger) load(currentLedger.id);
  }, [currentLedger?.id, showArchived]);

  const handleArchiveToggle = async (p: ProjectSummary) => {
    setOpenMenu(null);
    try {
      await api.put(`/projects/${p.id}`, {
        status: p.status === 'active' ? 'archived' : 'active',
      });
      if (currentLedger) load(currentLedger.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/projects/${deleting.id}`);
      setDeleting(null);
      if (currentLedger) load(currentLedger.id);
    } catch (err) {
      console.error(err);
    }
  };

  if (!currentLedger) {
    return (
      <Card>
        <EmptyState icon={<FolderKanban size={18} />} title={t('projects:selectLedger')} />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-widest">{currentLedger.name}</p>
          <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">{t('projects:title')}</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('projects:subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer">
            <input
              type="checkbox"
              className="accent-[var(--color-brand)]"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t('projects:showArchived')}
          </label>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowForm(true)}>
            {t('projects:newProject')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--color-text-subtle)]">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : projects.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<FolderKanban size={20} />}
            title={showArchived ? t('projects:emptyArchived') : t('projects:emptyActive')}
            description={t('projects:emptyDesc')}
            action={
              <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowForm(true)}>
                {t('projects:newProject')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => {
            const overBudget = p.budget.mode !== 'none' && p.budget.amount > 0 && p.spent > p.budget.amount;
            const usagePct = p.budget.mode !== 'none' && p.budget.amount > 0 ? Math.min(100, p.usage_pct) : 0;
            return (
              <Card
                key={p.id}
                padding="lg"
                className={cn(
                  'relative flex flex-col gap-3 transition-colors',
                  p.status === 'archived' && 'opacity-70',
                )}
              >
                <div className="flex items-start gap-3">
                  <CategoryIcon name={p.icon} color={p.color} size={44} />
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className="text-sm font-semibold text-[var(--color-text)] hover:text-[var(--color-brand)] text-left truncate block w-full"
                    >
                      {p.name}
                    </button>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge tone={p.budget.mode === 'none' ? 'neutral' : 'info'}>
                        {modeLabel(p.budget.mode)}
                      </Badge>
                      {p.status === 'archived' && <Badge tone="neutral">{t('projects:archived')}</Badge>}
                    </div>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
                      aria-label={t('projects:moreMenu')}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {openMenu === p.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                        <div className="absolute right-0 top-full mt-1 z-20 min-w-[160px] rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg py-1 text-sm">
                          <button
                            onClick={() => {
                              setBudgetEditing(p);
                              setOpenMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                          >
                            <Wallet size={14} /> {t('projects:editBudget')}
                          </button>
                          <button
                            onClick={() => {
                              setEditing(p);
                              setOpenMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                          >
                            <Pencil size={14} /> {t('projects:editInfo')}
                          </button>
                          <button
                            onClick={() => handleArchiveToggle(p)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                          >
                            {p.status === 'active' ? (
                              <>
                                <Archive size={14} /> {t('projects:archive')}
                              </>
                            ) : (
                              <>
                                <ArchiveRestore size={14} /> {t('projects:restore')}
                              </>
                            )}
                          </button>
                          <div className="h-px bg-[var(--color-border)] my-1" />
                          <button
                            onClick={() => {
                              setDeleting(p);
                              setOpenMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                          >
                            <Trash2 size={14} /> {t('projects:delete')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Budget progress */}
                {p.budget.mode === 'none' ? (
                  <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-[var(--color-text-subtle)]">{t('projects:cumulativeExpense')}</p>
                      <p className="text-sm font-semibold text-[var(--color-text)] font-tabular mt-0.5">
                        ¥{p.spent_total.toFixed(2)}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setBudgetEditing(p)}>
                      {t('projects:setBudget')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-[var(--color-text-subtle)] uppercase tracking-wider">
                        {p.budget.mode === 'monthly'
                          ? t('projects:spentMonthly', { ym: p.budget.year_month ?? '' })
                          : t('projects:spentCumulative')}
                      </span>
                      <span className={cn('text-sm font-semibold font-tabular', overBudget ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]')}>
                        ¥{p.spent.toFixed(2)}
                        <span className="text-[var(--color-text-subtle)] font-normal"> / ¥{p.budget.amount.toFixed(2)}</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--color-surface-muted)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${usagePct}%`,
                          background: overBudget
                            ? 'var(--color-danger)'
                            : p.color || 'var(--color-brand)',
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--color-text-subtle)]">
                      <span>
                        {overBudget ? t('projects:overBudget') : t('projects:pctUsed', { pct: usagePct.toFixed(0) })}
                      </span>
                      <span>
                        {t('projects:remaining')}{' '}
                        <span className={cn('font-tabular', overBudget ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]')}>
                          ¥{Math.max(0, p.budget.amount - p.spent).toFixed(2)}
                        </span>
                      </span>
                    </div>
                  </div>
                )}

                {p.note && (
                  <p className="text-[11px] text-[var(--color-text-subtle)] line-clamp-2">{p.note}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      {showForm && currentLedger && (
        <ProjectFormModal
          open
          ledgerId={currentLedger.id}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            if (currentLedger) load(currentLedger.id);
          }}
        />
      )}
      {editing && currentLedger && (
        <ProjectFormModal
          open
          ledgerId={currentLedger.id}
          initial={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            if (currentLedger) load(currentLedger.id);
          }}
        />
      )}
      {budgetEditing && (
        <ProjectBudgetModal
          open
          project={budgetEditing}
          onClose={() => setBudgetEditing(null)}
          onSuccess={() => {
            setBudgetEditing(null);
            if (currentLedger) load(currentLedger.id);
          }}
        />
      )}
      {deleting && (
        <Modal
          open
          onClose={() => setDeleting(null)}
          title={t('projects:deleteTitle')}
          description={t('projects:deleteDesc')}
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <CategoryIcon name={deleting.icon} color={deleting.color} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)] truncate">{deleting.name}</p>
                <p className="text-xs text-[var(--color-text-subtle)]">
                  {t('projects:spentTotalLine', { amount: deleting.spent_total.toFixed(2) })}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" fullWidth onClick={() => setDeleting(null)}>
                {t('common:cancel')}
              </Button>
              <Button variant="danger" fullWidth leftIcon={<Trash2 size={14} />} onClick={handleDelete}>
                {t('common:delete')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
