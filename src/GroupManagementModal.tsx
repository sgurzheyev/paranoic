/**
 * Group Settings / Management modal.
 *
 * Opens when the user taps the group name card in the chat header.
 * Supports:
 *   - Viewing members with roles
 *   - Adding new members (admin only)
 *   - Removing members (admin only)
 *   - Leaving the group
 *   - Deleting the group (admin only)
 *   - Renaming the group (admin only)
 */
import './groups.css';
import './GroupManagementModal.css';
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Crown,
  LogOut,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import Avatar from './Avatar';
import type { Contact } from './contacts';
import {
  addGroupMembers,
  deleteGroup,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  MAX_GROUP_MEMBERS,
  type GroupMember,
  type GroupSummary,
} from './groups';
import { useLanguage } from './i18n';

type Step = 'main' | 'add-members' | 'confirm-leave' | 'confirm-delete';

type Props = {
  open: boolean;
  group: GroupSummary;
  selfId: string;
  contacts: Contact[];
  onClose: () => void;
  /** Called after any mutation so App can refresh group list. */
  onRefresh: () => Promise<void>;
  /** Called after leave/delete so App can close the chat and go home. */
  onLeft: () => void;
};

export default function GroupManagementModal({
  open,
  group,
  selfId,
  contacts,
  onClose,
  onRefresh,
  onLeft,
}: Props) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('main');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState(false);
  // Safe fallback so hooks never see undefined even if group is momentarily stale.
  const [nameInput, setNameInput] = useState(group?.name ?? '');

  // Reset step / errors when modal opens or group changes.
  useEffect(() => {
    if (!open || !group?.id) return;
    setStep('main');
    setErr('');
    setSelected(new Set());
    setNameInput(group.name ?? '');
    setRenaming(false);
  }, [open, group?.id, group?.name]);

  const isAdmin = group?.myRole === 'admin';
  const safeMembers = group?.members ?? [];
  const memberIds = useMemo(() => new Set(safeMembers.map((m) => m.userId)), [safeMembers]);
  const isSoleAdmin = useMemo(() => {
    const admins = safeMembers.filter((m) => m.role === 'admin');
    return admins.length === 1 && admins[0]?.userId === selfId;
  }, [safeMembers, selfId]);

  // Contacts not already in the group.
  const addableCandidates = useMemo(
    () => contacts.filter((c) => c.id !== selfId && !memberIds.has(c.id)),
    [contacts, selfId, memberIds]
  );

  if (!open || !group?.id) return null;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('groups.mgmt.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  // ── Add members ─────────────────────────────────────────────────────────────
  const toggleCandidate = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if ((group?.memberCount ?? safeMembers.length) + next.size + 1 > MAX_GROUP_MEMBERS) {
          setErr(t('groups.maxMembers', { count: String(MAX_GROUP_MEMBERS) }));
          return prev;
        }
        next.add(id);
      }
      setErr('');
      return next;
    });
  };

  const confirmAddMembers = () =>
    run(async () => {
      await addGroupMembers({
        groupId: group.id,
        memberIds: [...selected],
        existingCount: group?.memberCount ?? safeMembers.length,
      });
      await onRefresh();
      setSelected(new Set());
      setStep('main');
    });

  // ── Remove member ───────────────────────────────────────────────────────────
  const handleRemove = (member: GroupMember) =>
    run(async () => {
      await removeGroupMember({ groupId: group.id, userId: member.userId });
      await onRefresh();
    });

  // ── Leave group ─────────────────────────────────────────────────────────────
  const confirmLeave = () =>
    run(async () => {
      await leaveGroup(group.id);
      onLeft();
    });

  // ── Delete group ─────────────────────────────────────────────────────────────
  const confirmDelete = () =>
    run(async () => {
      await deleteGroup(group.id);
      onLeft();
    });

  // ── Rename ──────────────────────────────────────────────────────────────────
  const confirmRename = () =>
    run(async () => {
      await renameGroup(group.id, nameInput);
      await onRefresh();
      setRenaming(false);
    });

  // ── Sorted member list: admins first ────────────────────────────────────────
  const sortedMembers = useMemo(
    () =>
      [...safeMembers].sort((a, b) => {
        if (a.role === b.role) return (a.name || '').localeCompare(b.name || '', 'ru');
        return a.role === 'admin' ? -1 : 1;
      }),
    [safeMembers]
  );

  return (
    <div
      className="group-mgmt-backdrop"
      role="presentation"
      onClick={() => {
        if (step !== 'main') { setStep('main'); return; }
        onClose();
      }}
    >
      <div
        className="group-mgmt-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('groups.mgmt.title')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="group-mgmt-head">
          {step !== 'main' ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => { setStep('main'); setErr(''); }}
              aria-label={t('common.back')}
            >
              ←
            </button>
          ) : (
            <span />
          )}
          <h3 className="group-mgmt-title">
            {step === 'main' && t('groups.mgmt.title')}
            {step === 'add-members' && t('groups.mgmt.addMembers')}
            {step === 'confirm-leave' && t('groups.mgmt.leaveGroup')}
            {step === 'confirm-delete' && t('groups.mgmt.deleteGroup')}
          </h3>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {err ? (
          <p className="group-mgmt-error" role="alert">{err}</p>
        ) : null}

        {/* ══════════════ MAIN VIEW ══════════════════════════════════════════ */}
        {step === 'main' && (
          <>
            {/* Group identity */}
            <div className="group-mgmt-identity">
              <span className="group-avatar-stack group-mgmt-big-avatar" aria-hidden>
                {sortedMembers.slice(0, 3).map((m, i) => (
                  <span
                    key={m.userId}
                    className="group-avatar-stack__face"
                    style={{ zIndex: 3 - i, background: m.color || '#60a5fa' }}
                  >
                    {(m.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                ))}
                {sortedMembers.length === 0 && (
                  <span className="group-avatar-fallback"><Users size={20} /></span>
                )}
              </span>
              {renaming ? (
                <div className="group-mgmt-rename-row">
                  <input
                    className="group-mgmt-rename-input"
                    value={nameInput}
                    maxLength={80}
                    autoFocus
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void confirmRename();
                      if (e.key === 'Escape') { setRenaming(false); setNameInput(group?.name ?? ''); }
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn group-mgmt-rename-confirm"
                    disabled={busy || !nameInput.trim()}
                    onClick={() => void confirmRename()}
                    aria-label={t('common.save')}
                  >
                    <Check size={16} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`group-mgmt-name-btn${isAdmin ? ' is-editable' : ''}`}
                  disabled={!isAdmin}
                  title={isAdmin ? t('groups.mgmt.tapToRename') : undefined}
                  onClick={() => { if (isAdmin) setRenaming(true); }}
                >
                  {group.name ?? ''}
                  {isAdmin && <ChevronRight size={14} className="group-mgmt-edit-caret" />}
                </button>
              )}
              <p className="group-mgmt-count">
                {t('groups.memberCount', { count: String(group?.memberCount ?? safeMembers.length) })}
              </p>
            </div>

            {/* Member list */}
            <ul className="group-mgmt-member-list">
              {sortedMembers.map((m) => {
                const isSelf = m.userId === selfId;
                const canRemove = isAdmin && !isSelf;
                return (
                  <li key={m.userId} className="group-mgmt-member-row">
                    <Avatar
                      name={m.name || m.userId.slice(0, 6)}
                      color={m.color}
                      avatarUrl={m.avatarUrl}
                      size="sm"
                    />
                    <span className="group-mgmt-member-info">
                      <span className="group-mgmt-member-name">
                        {m.name || m.userId.slice(0, 8)}
                        {isSelf && (
                          <span className="group-mgmt-you"> ({t('common.you')})</span>
                        )}
                      </span>
                      {m.role === 'admin' && (
                        <span className="group-mgmt-role-badge">
                          <Crown size={11} aria-hidden /> {t('groups.mgmt.admin')}
                        </span>
                      )}
                    </span>
                    {canRemove && (
                      <button
                        type="button"
                        className="icon-btn group-mgmt-remove-btn"
                        disabled={busy}
                        aria-label={t('groups.mgmt.removeMember')}
                        onClick={() => void handleRemove(m)}
                      >
                        <UserMinus size={15} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Action buttons */}
            <div className="group-mgmt-actions">
              {isAdmin && (group?.memberCount ?? safeMembers.length) < MAX_GROUP_MEMBERS && (
                <button
                  type="button"
                  className="group-mgmt-action-btn is-add"
                  disabled={busy}
                  onClick={() => { setErr(''); setStep('add-members'); }}
                >
                  <UserPlus size={15} /> {t('groups.mgmt.addMembers')}
                </button>
              )}
              <button
                type="button"
                className="group-mgmt-action-btn is-leave"
                disabled={busy}
                onClick={() => { setErr(''); setStep('confirm-leave'); }}
              >
                <LogOut size={15} />
                {isSoleAdmin
                  ? t('groups.mgmt.leavePromoteFirst')
                  : t('groups.mgmt.leaveGroup')}
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="group-mgmt-action-btn is-delete"
                  disabled={busy}
                  onClick={() => { setErr(''); setStep('confirm-delete'); }}
                >
                  <Trash2 size={15} /> {t('groups.mgmt.deleteGroup')}
                </button>
              )}
            </div>
          </>
        )}

        {/* ══════════════ ADD MEMBERS ════════════════════════════════════════ */}
        {step === 'add-members' && (
          <>
            <p className="group-mgmt-hint">
              {t('groups.pickMembers', {
                selected: String(selected.size),
                max: String(MAX_GROUP_MEMBERS - (group?.memberCount ?? safeMembers.length)),
              })}
            </p>
            {addableCandidates.length === 0 ? (
              <p className="group-mgmt-hint">{t('groups.mgmt.noNewContacts')}</p>
            ) : (
              <ul className="create-group-modal__list">
                {addableCandidates.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`create-group-modal__row${on ? ' is-selected' : ''}`}
                        onClick={() => toggleCandidate(c.id)}
                      >
                        <Avatar name={c.name} color={c.color} avatarUrl={c.avatarUrl} size="sm" />
                        <span className="contact-name truncate">{c.name}</span>
                        <span className={`create-group-modal__check${on ? ' on' : ''}`} aria-hidden>
                          {on ? <Check size={14} /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="create-group-modal__foot">
              <button type="button" className="text-link" onClick={() => setStep('main')} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="mega-btn call"
                disabled={busy || selected.size === 0}
                onClick={() => void confirmAddMembers()}
              >
                {busy ? t('common.loading') : t('groups.mgmt.addAction')}
              </button>
            </div>
          </>
        )}

        {/* ══════════════ CONFIRM LEAVE ══════════════════════════════════════ */}
        {step === 'confirm-leave' && (
          <div className="group-mgmt-confirm">
            <p>{isSoleAdmin
              ? t('groups.mgmt.leaveConfirmAdmin')
              : t('groups.mgmt.leaveConfirm', { name: group?.name ?? '' })}</p>
            <div className="create-group-modal__foot">
              <button type="button" className="text-link" onClick={() => setStep('main')} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="mega-btn is-danger"
                disabled={busy}
                onClick={() => void confirmLeave()}
              >
                {busy ? t('common.loading') : t('groups.mgmt.leaveAction')}
              </button>
            </div>
          </div>
        )}

        {/* ══════════════ CONFIRM DELETE ═════════════════════════════════════ */}
        {step === 'confirm-delete' && (
          <div className="group-mgmt-confirm">
            <p>{t('groups.mgmt.deleteConfirm', { name: group?.name ?? '' })}</p>
            <div className="create-group-modal__foot">
              <button type="button" className="text-link" onClick={() => setStep('main')} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="mega-btn is-danger"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {busy ? t('common.loading') : t('groups.mgmt.deleteAction')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
