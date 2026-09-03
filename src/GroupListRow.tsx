import './groups.css';
import { Users } from 'lucide-react';
import type { GroupSummary } from './groups';
import { groupConversationId } from './groups';
import { useLanguage } from './i18n';
import type { LastMessagePreview } from './storage';

type GroupListRowProps = {
  group: GroupSummary;
  preview?: LastMessagePreview;
  onOpen: () => void;
};

/** Chats-tab row for a group conversation. */
export default function GroupListRow({ group, preview, onOpen }: GroupListRowProps) {
  const { t } = useLanguage();
  const faces = group.members.slice(0, 3);
  const subtitle =
    preview?.snippet ||
    t('groups.memberCount', { count: String(group.memberCount) });

  return (
    <li className="contact-list-item">
      <button
        type="button"
        className="contact-row contact-row--info"
        aria-label={t('groups.openAria', { name: group.name })}
        onClick={onOpen}
        data-group-id={groupConversationId(group.id)}
      >
        <span className="group-avatar-stack" aria-hidden>
          {faces.length === 0 ? (
            <span className="group-avatar-fallback">
              <Users size={16} />
            </span>
          ) : (
            faces.map((m, i) => (
              <span
                key={m.userId}
                className="group-avatar-stack__face"
                style={{
                  zIndex: faces.length - i,
                  background: m.color || '#60a5fa',
                }}
                title={m.name || m.userId.slice(0, 6)}
              >
                {(m.name || '?').slice(0, 1).toUpperCase()}
              </span>
            ))
          )}
        </span>
        <span className="contact-info min-w-0 flex-1">
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="contact-name min-w-0 truncate">{group.name}</span>
            {preview?.timeLabel ? (
              <span className="shrink-0 text-xs text-gray-400">{preview.timeLabel}</span>
            ) : null}
          </span>
          <span className="truncate text-sm text-gray-400">{subtitle}</span>
        </span>
      </button>
    </li>
  );
}
