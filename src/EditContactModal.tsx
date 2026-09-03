/**
 * Edit / Add to Private Address Book modal.
 * Stores a custom First Name, Last Name, and Private Note for a peer.
 * Data never leaves the device — stored only in IndexedDB via localContacts.ts.
 */
import './EditContactModal.css';
import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import Avatar from './Avatar';
import { useLanguage } from './i18n';
import {
  deleteLocalContact,
  localContactDisplayName,
  saveLocalContact,
  type LocalContact,
} from './localContacts';

type Props = {
  open: boolean;
  peerId: string;
  peerPublicName: string;
  peerColor: string;
  peerAvatarUrl?: string;
  /** Existing local contact data, if any. */
  existing: LocalContact | null;
  onClose: () => void;
  /** Called after a save or delete so the parent can refresh display names. */
  onSaved: (updated: LocalContact | null) => void;
};

export default function EditContactModal({
  open,
  peerId,
  peerPublicName,
  peerColor,
  peerAvatarUrl,
  existing,
  onClose,
  onSaved,
}: Props) {
  const { t } = useLanguage();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Populate fields from existing data when the modal opens.
  useEffect(() => {
    if (!open) return;
    setFirstName(existing?.firstName ?? '');
    setLastName(existing?.lastName ?? '');
    setNote(existing?.note ?? '');
    setErr('');
    setBusy(false);
    setConfirmDelete(false);
  }, [open, existing]);

  if (!open) return null;

  const previewName =
    [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || peerPublicName;

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const saved = await saveLocalContact({
        id: peerId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        note: note.trim(),
      });
      onSaved(saved);
      onClose();
    } catch {
      setErr(t('localContact.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    if (busy) return;
    setBusy(true);
    try {
      await deleteLocalContact(peerId);
      onSaved(null);
      onClose();
    } catch {
      setErr(t('localContact.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="ec-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="ec-modal"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? t('localContact.editTitle') : t('localContact.addTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ec-head">
          <h3 className="ec-title">
            {existing ? t('localContact.editTitle') : t('localContact.addTitle')}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        {/* Hero */}
        <div className="ec-hero">
          <Avatar name={previewName} color={peerColor} avatarUrl={peerAvatarUrl} size="lg" />
          <span className="ec-preview-name">{previewName}</span>
          {previewName !== peerPublicName && (
            <span className="ec-public-name">({peerPublicName})</span>
          )}
        </div>

        {/* Fields */}
        <div className="ec-fields">
          <label className="ec-label">
            {t('localContact.firstName')}
            <input
              className="ec-input"
              type="text"
              value={firstName}
              maxLength={60}
              placeholder={t('localContact.firstName')}
              autoFocus
              onChange={(e) => setFirstName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
            />
          </label>
          <label className="ec-label">
            {t('localContact.lastName')}
            <input
              className="ec-input"
              type="text"
              value={lastName}
              maxLength={60}
              placeholder={t('localContact.lastName')}
              onChange={(e) => setLastName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
            />
          </label>
          <label className="ec-label">
            {t('localContact.note')}
            <textarea
              className="ec-input ec-textarea"
              value={note}
              maxLength={500}
              rows={3}
              placeholder={t('localContact.notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>

        {err && <p className="ec-error" role="alert">{err}</p>}

        {/* Footer */}
        <div className="ec-foot">
          {existing && (
            <button
              type="button"
              className={`ec-delete-btn${confirmDelete ? ' is-confirm' : ''}`}
              disabled={busy}
              onClick={() => void handleDelete()}
              aria-label={t('localContact.delete')}
            >
              <Trash2 size={15} />
              {confirmDelete ? t('localContact.deleteConfirm') : t('localContact.delete')}
            </button>
          )}
          <div className="ec-foot-actions">
            <button type="button" className="text-link" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="mega-btn call"
              disabled={busy}
              onClick={() => void handleSave()}
            >
              {busy ? t('common.loading') : t('localContact.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
