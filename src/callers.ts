import type { CallerInfo } from './callSignaling';
import type { Contact } from './contacts';
import { fetchRemoteProfile } from './profile';
import type { PresenceUser } from './presence';

/** Caller ID для входящего join / звонка. */
export async function resolveCallerInfo(
  peerId: string,
  contacts: Contact[],
  presenceUsers: PresenceUser[]
): Promise<CallerInfo> {
  const known = contacts.find((c) => c.id === peerId);
  const presence = presenceUsers.find((u) => u.userId === peerId);

  if (known || presence) {
    return {
      id: peerId,
      name: known?.name || presence?.name || 'Гость',
      username: '',
      avatarUrl: presence?.avatarUrl || known?.avatarUrl || '',
      color: presence?.color || known?.color || '#60a5fa',
    };
  }

  const remote = await fetchRemoteProfile(peerId);
  return {
    id: peerId,
    name: remote?.name || `Гость ${peerId.slice(0, 8)}`,
    username: remote?.username || '',
    avatarUrl: remote?.avatar_url || '',
    color: remote?.color || '#60a5fa',
  };
}
