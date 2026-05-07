import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/client';
import { Button, Modal } from './ui';
import SplitAllocationsEditor, {
  type SplitAllocation,
  validateAllocations,
} from './SplitAllocationsEditor';

interface Props {
  open: boolean;
  /** Source family-ledger transaction to convert */
  transaction: {
    id: string;
    amount: number;
    note?: string;
  };
  /** Personal sub-ledgers linked under the source family ledger */
  splitTargets: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * ConvertToSplitModal — turn an existing family-ledger transaction into a
 * split group. The source row is deleted server-side; N child transactions
 * land in the chosen personal sub-ledgers.
 */
export default function ConvertToSplitModal({
  open,
  transaction,
  splitTargets,
  onClose,
  onSuccess,
}: Props) {
  const { t } = useTranslation(['modals', 'common']);
  const [allocations, setAllocations] = useState<SplitAllocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAllocations([]);
      setError('');
    }
  }, [open, transaction.id]);

  const submit = async () => {
    const v = validateAllocations(allocations, transaction.amount);
    if (!v.ok) {
      setError(t(`modals:${v.key}`));
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.post(`/transactions/${transaction.id}/convert-to-split`, {
        allocations: allocations.map((a) => ({
          target_ledger_id: a.target_ledger_id,
          amount: parseFloat(a.amount),
        })),
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          t('modals:splitConvertFailed'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t('modals:splitConvertTitle')}
      description={t('modals:splitConvertDesc', { amount: transaction.amount.toFixed(2) })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
          <Button loading={loading} onClick={submit}>
            {t('modals:splitConvertSubmit')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {transaction.note && (
          <p className="text-xs text-[var(--color-text-muted)] italic">{transaction.note}</p>
        )}
        <SplitAllocationsEditor
          targets={splitTargets}
          totalAmount={transaction.amount}
          allocations={allocations}
          onChange={setAllocations}
        />
        {error && (
          <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
