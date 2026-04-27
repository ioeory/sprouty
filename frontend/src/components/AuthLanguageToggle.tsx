import { useTranslation } from 'react-i18next';
import i18n, { setAppLocale } from '../i18n';
import { cn } from './ui';

/** 登录 / 注册页顶栏：仅切换 i18n + localStorage（未登录不调用户偏好 API） */
export function AuthLanguageToggle() {
  const { t } = useTranslation('common');

  return (
    <div
      className="flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-sm"
      role="group"
      aria-label={t('language')}
    >
      <button
        type="button"
        onClick={() => setAppLocale('zh-CN')}
        className={cn(
          'px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors',
          (i18n.language || '').startsWith('zh')
            ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]',
        )}
      >
        {t('lang_zh')}
      </button>
      <button
        type="button"
        onClick={() => setAppLocale('en')}
        className={cn(
          'px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors',
          (i18n.language || '').startsWith('en')
            ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]',
        )}
      >
        {t('lang_en')}
      </button>
    </div>
  );
}
