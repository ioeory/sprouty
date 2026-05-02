import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Modal } from './ui';

export interface LedgerDrillRow {
  ledger_id: string;
  ledger_name: string;
  amount: number;
  count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  loading: boolean;
  rows: LedgerDrillRow[];
}

export default function CategoryLedgerDrillModal({ open, onClose, title, loading, rows }: Props) {
  const { t } = useTranslation('dashboard');

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[var(--color-text-subtle)]">
          <Loader2 className="animate-spin" size={22} />
          <span className="text-sm">{t('categoryDrillLoading')}</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] py-4">{t('categoryDrillEmpty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-text-subtle)] border-b border-[var(--color-border)]">
              <th className="pb-2 font-medium">{t('categoryDrillColLedger')}</th>
              <th className="pb-2 font-medium text-right">{t('categoryDrillColAmount')}</th>
              <th className="pb-2 font-medium text-right">{t('categoryDrillColCount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ledger_id} className="border-b border-[var(--color-border)]/60 last:border-0">
                <td className="py-2.5 text-[var(--color-text)]">{r.ledger_name}</td>
                <td className="py-2.5 text-right font-tabular text-[var(--color-text)]">
                  ¥{Number(r.amount).toLocaleString()}
                </td>
                <td className="py-2.5 text-right font-tabular text-[var(--color-text-muted)]">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
