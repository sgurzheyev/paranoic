import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { APP_LANGUAGES, type AppLanguage, type AppLanguageOption } from '../settings';

type LanguagePickerModalProps = {
  open: boolean;
  language: AppLanguage;
  title: string;
  ariaLabel: string;
  closeLabel: string;
  onClose: () => void;
  onSelect: (language: AppLanguage) => void;
};

export default function LanguagePickerModal({
  open,
  language,
  title,
  ariaLabel,
  closeLabel,
  onClose,
  onSelect,
}: LanguagePickerModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="language-picker-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="language-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="language-picker-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>
            <X size={18} />
          </button>
        </div>
        <ul className="language-picker-list" role="listbox" aria-label={ariaLabel}>
          {APP_LANGUAGES.map((lang: AppLanguageOption) => {
            const active = language === lang.id;
            return (
              <li key={lang.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`language-picker-option${active ? ' is-active' : ''}`}
                  onClick={() => {
                    onSelect(lang.id);
                    onClose();
                  }}
                >
                  <span className="language-picker-flag" aria-hidden>
                    {lang.flag}
                  </span>
                  <span className="language-picker-label">{lang.label}</span>
                  {active ? (
                    <Check className="language-picker-check" size={16} aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body
  );
}
