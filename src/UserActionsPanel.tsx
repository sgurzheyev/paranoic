import { useState } from 'react';
import { Ban, Flag, Loader2, Trash2 } from 'lucide-react';
import { useLanguage } from './i18n';
import {
  REPORT_REASON_KEYS,
  blockUserSafety,
  reportUserSafety,
  type ReportReasonKey,
} from './userSafety';

type UserActionsPanelProps = {
  peerId: string;
  peerName: string;
  /** Already blocked locally / in peer relations. */
  isBlocked?: boolean;
  /** After a successful block (parent refreshes IDs, disconnects, closes modal). */
  onBlocked?: () => void;
  /** Delete from address book + clear peer session (parent handles storage/nav). */
  onDeleteContact?: () => void | Promise<void>;
};

/**
 * Play-compliance Block & Report controls for a peer profile / chat settings.
 */
export default function UserActionsPanel({
  peerId,
  peerName,
  isBlocked = false,
  onBlocked,
  onDeleteContact,
}: UserActionsPanelProps) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<'block' | 'report' | 'delete' | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reasonKey, setReasonKey] = useState<ReportReasonKey>('spam');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const reasonLabel = (key: ReportReasonKey) => t(`safety.reason.${key}`);

  const handleBlock = async () => {
    if (isBlocked || busy) return;
    const ok = window.confirm(t('safety.blockConfirm', { name: peerName }));
    if (!ok) return;

    setBusy('block');
    setStatus(null);
    try {
      const result = await blockUserSafety(peerId);
      if (!result.ok) {
        setStatus({ kind: 'err', text: result.message || t('safety.blockFailed') });
        return;
      }
      setStatus({ kind: 'ok', text: t('safety.blockSuccess', { name: peerName }) });
      onBlocked?.();
    } finally {
      setBusy(null);
    }
  };

  const handleReport = async () => {
    if (busy) return;
    const reasonText = [reasonLabel(reasonKey), details.trim()]
      .filter(Boolean)
      .join(': ')
      .slice(0, 500);

    setBusy('report');
    setStatus(null);
    try {
      const result = await reportUserSafety(peerId, reasonText);
      if (!result.ok) {
        setStatus({ kind: 'err', text: result.message || t('safety.reportFailed') });
        return;
      }
      setStatus({ kind: 'ok', text: t('safety.reportSuccess') });
      setReportOpen(false);
      setDetails('');
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteContact = async () => {
    if (busy || !onDeleteContact) return;
    if (!window.confirm(t('safety.deleteConfirm'))) return;

    setBusy('delete');
    setStatus(null);
    try {
      await onDeleteContact();
    } catch (e) {
      const message = e instanceof Error ? e.message : t('safety.deleteFailed');
      setStatus({ kind: 'err', text: message || t('safety.deleteFailed') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="user-actions-panel peer-profile-section" aria-label={t('safety.sectionAria')}>
      <p className="peer-profile-label">{t('safety.sectionTitle')}</p>

      <div className="user-actions-row">
        <button
          type="button"
          className="user-actions-btn block"
          disabled={isBlocked || busy === 'block'}
          onClick={() => void handleBlock()}
        >
          {busy === 'block' ? <Loader2 size={15} className="spin" /> : <Ban size={15} />}
          {isBlocked ? t('safety.blocked') : t('safety.blockUser')}
        </button>
        <button
          type="button"
          className={`user-actions-btn report${reportOpen ? ' is-open' : ''}`}
          disabled={busy === 'report'}
          onClick={() => {
            setReportOpen((v) => !v);
            setStatus(null);
          }}
        >
          <Flag size={15} />
          {t('safety.reportUser')}
        </button>
      </div>

      {onDeleteContact ? (
        <button
          type="button"
          className="user-actions-btn delete text-red-500 border border-red-500 hover:bg-red-500/10"
          disabled={busy === 'delete'}
          onClick={() => void handleDeleteContact()}
        >
          {busy === 'delete' ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
          {t('safety.deleteContact')}
        </button>
      ) : null}

      {reportOpen ? (
        <div className="user-actions-report">
          <p className="user-actions-hint">{t('safety.reportHint')}</p>
          <label className="user-actions-field">
            <span>{t('safety.reasonLabel')}</span>
            <select
              value={reasonKey}
              onChange={(e) => setReasonKey(e.target.value as ReportReasonKey)}
              disabled={busy === 'report'}
            >
              {REPORT_REASON_KEYS.map((key) => (
                <option key={key} value={key}>
                  {reasonLabel(key)}
                </option>
              ))}
            </select>
          </label>
          <label className="user-actions-field">
            <span>{t('safety.detailsLabel')}</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 400))}
              rows={3}
              maxLength={400}
              placeholder={t('safety.detailsPlaceholder')}
              disabled={busy === 'report'}
            />
          </label>
          <button
            type="button"
            className="user-actions-btn report-submit"
            disabled={busy === 'report'}
            onClick={() => void handleReport()}
          >
            {busy === 'report' ? <Loader2 size={15} className="spin" /> : <Flag size={15} />}
            {t('safety.reportSubmit')}
          </button>
        </div>
      ) : null}

      {status ? (
        <p
          className={`user-actions-status${status.kind === 'err' ? ' is-err' : ' is-ok'}`}
          role="status"
        >
          {status.text}
        </p>
      ) : null}
    </section>
  );
}
