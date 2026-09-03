/**
 * Group chats: Supabase tables + Realtime broadcast for live delivery.
 * Offline members still get store-and-forward fan-out (see storeForward).
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { ensureAuthSession, getSupabase, hasSupabaseConfig } from './lib/supabase';
import { groupConversationId as storageGroupConversationId } from './storage';

export const MAX_GROUP_MEMBERS = 20;

export type GroupRole = 'admin' | 'member';

export type GroupRecord = {
  id: string;
  name: string;
  createdBy: string;
  avatarUrl: string;
  createdAt: string;
};

export type GroupMember = {
  groupId: string;
  userId: string;
  role: GroupRole;
  joinedAt: string;
  name?: string;
  avatarUrl?: string;
  color?: string;
};

export type GroupSummary = GroupRecord & {
  memberCount: number;
  myRole: GroupRole;
  members: GroupMember[];
};

/** Local + SAF conversation id for a group. */
export function groupConversationId(groupId: string): string {
  return storageGroupConversationId(groupId);
}

export function parseGroupConversationId(convId: string): string | null {
  if (!convId.startsWith('group:')) return null;
  const id = convId.slice('group:'.length).trim();
  return id || null;
}

export function isGroupConversationId(convId: string | null | undefined): boolean {
  return Boolean(convId && parseGroupConversationId(convId));
}

/** Shared PBKDF2 room for group ciphertext (Realtime + SAF). */
export function groupRoomId(groupId: string): string {
  return `group-${groupId}`;
}

export type GroupRealtimePayload = {
  type: 'group_msg';
  groupId: string;
  messageId: string;
  fromUserId: string;
  senderName: string;
  kind: 'text' | 'media';
  cipher: string;
  iv: string;
  mediaMime?: string;
  mediaName?: string;
  mediaSize?: number;
  at: number;
};

function channelName(groupId: string): string {
  return `group:${groupId}`;
}

async function requireUid(): Promise<string> {
  const session = await ensureAuthSession();
  const uid = session.user.id?.trim();
  if (!uid) throw new Error('Нужен вход');
  return uid;
}

export async function listMyGroups(): Promise<GroupSummary[]> {
  if (!hasSupabaseConfig()) return [];
  const uid = await requireUid();
  const sb = getSupabase();

  const { data: memberships, error: memErr } = await sb
    .from('group_members')
    .select('group_id, role, joined_at')
    .eq('user_id', uid);
  if (memErr) {
    console.warn('[groups] list memberships', memErr.message);
    return [];
  }
  const mine = memberships ?? [];
  if (mine.length === 0) return [];

  const groupIds = mine.map((m) => m.group_id as string);
  const { data: groups, error: gErr } = await sb
    .from('groups')
    .select('id, name, created_by, avatar_url, created_at')
    .in('id', groupIds);
  if (gErr) {
    console.warn('[groups] list groups', gErr.message);
    return [];
  }

  const { data: allMembers, error: amErr } = await sb
    .from('group_members')
    .select('group_id, user_id, role, joined_at')
    .in('group_id', groupIds);
  if (amErr) console.warn('[groups] list members', amErr.message);

  const memberUserIds = [
    ...new Set((allMembers ?? []).map((m) => m.user_id as string)),
  ];
  const profileMap = new Map<
    string,
    { name?: string; avatar_url?: string | null; color?: string | null }
  >();
  if (memberUserIds.length > 0) {
    const { data: profiles } = await sb
      .from('profiles')
      .select('id, name, avatar_url, color')
      .in('id', memberUserIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id as string, p);
    }
  }

  const roleByGroup = new Map(
    mine.map((m) => [m.group_id as string, m.role as GroupRole])
  );

  return (groups ?? [])
    .map((g) => {
      const members: GroupMember[] = (allMembers ?? [])
        .filter((m) => m.group_id === g.id)
        .map((m) => {
          const profile = profileMap.get(m.user_id as string);
          return {
            groupId: g.id as string,
            userId: m.user_id as string,
            role: m.role as GroupRole,
            joinedAt: m.joined_at as string,
            name: profile?.name || undefined,
            avatarUrl: profile?.avatar_url || undefined,
            color: profile?.color || undefined,
          };
        });
      return {
        id: g.id as string,
        name: g.name as string,
        createdBy: g.created_by as string,
        avatarUrl: (g.avatar_url as string) || '',
        createdAt: g.created_at as string,
        memberCount: members.length,
        myRole: roleByGroup.get(g.id as string) || 'member',
        members,
      } satisfies GroupSummary;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Create a group: insert group row, add creator as admin, add selected members.
 * Enforces max 20 including creator.
 */
export async function createGroup(opts: {
  name: string;
  memberIds: string[];
  avatarUrl?: string;
}): Promise<GroupSummary> {
  if (!hasSupabaseConfig()) {
    throw new Error('Supabase не настроен');
  }
  const name = opts.name.trim();
  if (!name) throw new Error('Введите название группы');

  const uid = await requireUid();
  const uniqueMembers = [
    ...new Set(opts.memberIds.filter((id) => id && id !== uid)),
  ];
  if (uniqueMembers.length + 1 > MAX_GROUP_MEMBERS) {
    throw new Error(`В группе максимум ${MAX_GROUP_MEMBERS} участников`);
  }
  if (uniqueMembers.length < 1) {
    throw new Error('Выберите хотя бы одного участника');
  }

  const sb = getSupabase();
  const { data: group, error: gErr } = await sb
    .from('groups')
    .insert({
      name,
      created_by: uid,
      avatar_url: opts.avatarUrl || null,
    })
    .select('id, name, created_by, avatar_url, created_at')
    .single();
  if (gErr || !group) {
    throw new Error(gErr?.message || 'Не удалось создать группу');
  }

  const groupId = group.id as string;
  const memberRows = [
    { group_id: groupId, user_id: uid, role: 'admin' as const },
    ...uniqueMembers.map((id) => ({
      group_id: groupId,
      user_id: id,
      role: 'member' as const,
    })),
  ];

  const { error: mErr } = await sb.from('group_members').insert(memberRows);
  if (mErr) {
    await sb.from('groups').delete().eq('id', groupId);
    throw new Error(mErr.message || 'Не удалось добавить участников');
  }

  const list = await listMyGroups();
  const created = list.find((g) => g.id === groupId);
  if (created) return created;

  return {
    id: groupId,
    name: group.name as string,
    createdBy: group.created_by as string,
    avatarUrl: (group.avatar_url as string) || '',
    createdAt: group.created_at as string,
    memberCount: memberRows.length,
    myRole: 'admin',
    members: memberRows.map((r) => ({
      groupId,
      userId: r.user_id,
      role: r.role,
      joinedAt: new Date().toISOString(),
    })),
  };
}

const liveGroupChannels = new Map<string, RealtimeChannel>();

/** Subscribe to live group message broadcasts (one channel per group). */
export function subscribeGroupChannel(
  groupId: string,
  onMessage: (payload: GroupRealtimePayload) => void
): RealtimeChannel | null {
  if (!hasSupabaseConfig() || !groupId) return null;
  const existing = liveGroupChannels.get(groupId);
  if (existing) {
    void getSupabase().removeChannel(existing);
    liveGroupChannels.delete(groupId);
  }
  const sb = getSupabase();
  const ch = sb.channel(channelName(groupId), {
    config: { broadcast: { self: false } },
  });
  ch.on('broadcast', { event: 'group_msg' }, ({ payload }) => {
    const msg = payload as GroupRealtimePayload;
    if (!msg || msg.type !== 'group_msg' || msg.groupId !== groupId) return;
    onMessage(msg);
  });
  void ch.subscribe();
  liveGroupChannels.set(groupId, ch);
  return ch;
}

export async function broadcastGroupMessage(
  groupId: string,
  payload: Omit<GroupRealtimePayload, 'type' | 'groupId'>
): Promise<void> {
  if (!hasSupabaseConfig()) return;
  const body = {
    type: 'group_msg' as const,
    groupId,
    ...payload,
  } satisfies GroupRealtimePayload;

  const live = liveGroupChannels.get(groupId);
  if (live) {
    await live.send({ type: 'broadcast', event: 'group_msg', payload: body });
    return;
  }

  const sb = getSupabase();
  const ch = sb.channel(channelName(groupId), {
    config: { broadcast: { self: false } },
  });
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('group channel timeout')), 8_000);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        window.clearTimeout(timer);
        reject(new Error(`group channel ${status}`));
      }
    });
  });
  try {
    await ch.send({ type: 'broadcast', event: 'group_msg', payload: body });
  } finally {
    void sb.removeChannel(ch);
  }
}

export async function unsubscribeGroupChannel(
  channel: RealtimeChannel | null,
  groupId?: string
): Promise<void> {
  if (!hasSupabaseConfig()) return;
  if (groupId) liveGroupChannels.delete(groupId);
  if (!channel) return;
  try {
    await getSupabase().removeChannel(channel);
  } catch {
    /* */
  }
}

export async function unsubscribeAllGroupChannels(): Promise<void> {
  if (!hasSupabaseConfig()) return;
  const sb = getSupabase();
  const channels = [...liveGroupChannels.values()];
  liveGroupChannels.clear();
  await Promise.all(channels.map((ch) => sb.removeChannel(ch).catch(() => undefined)));
}
