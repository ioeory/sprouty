import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2 } from 'lucide-react';
import api from '../api/client';
import { Button, Modal } from './ui';

interface ChildTx {
  id: string;
  amount: number;
  ledger_id: string;
  category_id: string;
  date: string;
}

interface GroupResp {
  id: string;
  source_ledger_id: string;
  total_amount: number;
  type: string;
  category_id: string;
  note: string;
  date: string;
  child_count: number;
  children: ChildTx[];
}

interface Props {
  open: boolean;
  splitGroupId: string;
  /** Map ledger ids to display names for the children list */
  ledgerNameById: Record<string, string>;
  onClose: () => void;
  /** Called after the group is deleted so the caller can refresh its lists */
  onDeleted: () => void;
}

/**
 * SplitGroupDrawer — modal showing every child transaction inside a split
 * group, plus the option to delete the entire group with a confirm step.
 *
 * The "delete" path explicitly tells the user N children will be removed
 * (per the product spec for this feature).
 */
export default function SplitGroupDrawer({ open, splitGroupId, ledgerNameById, onClose, onDeleted }: Props) {
  const { t } = useTranslation(['modals', 'common']);
  const [group, setGroup] = useState<GroupResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError('');
    setConfirmingDelete(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    api
      .get(`/split-groups/${splitGroupId}`)
      .then((res) => {
        if (!cancelled) setGroup(res.data as GroupResp);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.error || t('modals:splitGroupLoadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, splitGroupId, t]);

  const handleDelete = async () => {
    if (!group) return;
    setDeleting(true);
    setError('');
    try {
      await api.delete(`/split-groups/${group.id}`);
      onDeleted();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('modals:splitGroupDeleteFailed');
      setError(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t('modals:splitGroupTitle')}
      description={
        group
          ? t('modals:splitGroupDesc', {
              source: ledgerNameById[group.source_ledger_id] || '—',
              count: group.child_count,
            })
          : ''
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
          {group && !confirmingDelete && (
            <Button variant="danger" leftIcon={<Trash2 size={14} />} onClick={() => setConfirmingDelete(true)}>
              {t('modals:splitGroupDelete')}
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-8 text-[var(--color-text-subtle)]">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : error ? (
        <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      ) : group ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <p className="text-[10px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('modals:splitGroupTotal')}</p>
              <p className="text-base font-semibold font-tabular text-[var(--color-text)] mt-0.5">¥{group.total_amount.toFixed(2)}</p>
            </div>
            <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]">
              <p className="text-[10px] text-[var(--color-text-subtle)] uppercase tracking-wider">{t('modals:splitGroupChildren')}</p>
              <p className="text-base font-semibold font-tabular text-[var(--color-text)] mt-0.5">{group.child_count}</p>
            </div>
          </div>
          {group.note && (
            <div className="text-xs text-[var(--color-text-muted)]">{group.note}</div>
          )}
          <div className="border border-[var(--color-border)] rounded-[var(--radius-md)] divide-y divide-[var(--color-border)]">
            {group.children.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="text-[var(--color-text)] truncate">
                  {ledgerNameById[ch.ledger_id] || ch.ledger_id}
                </span>
                <span className="font-tabular font-semibold text-[var(--color-text)]">¥{ch.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {confirmingDelete && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)] space-y-2">
              <p>{t('modals:splitGroupDeleteConfirm', { count: group.child_count })}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)}>
                  {t('common:cancel')}
                </Button>
                <Button size="sm" variant="danger" loading={deleting} onClick={handleDelete}>
                  {t('modals:splitGroupDeleteConfirmBtn')}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
