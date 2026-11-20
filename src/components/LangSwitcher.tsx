import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../lib/i18n';

/** Compact dropdown that swaps the whole UI's language. Writes to
 * localStorage (via i18next-browser-languagedetector) so the choice
 * sticks across visits. Deliberately plain select for accessibility. */
export function LangSwitcher({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">{t('lang.label', 'Language')}</span>
      <select
        value={current}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        className="appearance-none h-9 pl-3 pr-7 rounded-full border border-ink/15 bg-white text-ink text-[0.85rem] font-medium focus:outline-none focus:border-leaf hover:border-ink/30 transition-colors cursor-pointer"
        aria-label={t('lang.label', 'Language')}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 10 6"
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-2.5 h-1.5"
      >
        <path d="M0 0l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </label>
  );
}
