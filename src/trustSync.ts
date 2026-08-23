import { ensureAuthSession, getAuthUserId, getSupabase, hasSupabaseConfig } from './lib/supabase';

export const USER_PEER_RELATIONS_TABLE = 'user_peer_relations';

export type PeerRelations = {
  trusted: Set<string>;
  blocked: Set<string>;
};

const TRUSTED_KEY = 'paranoic-trusted-ids-v1';
const BLOCKED_KEY = 'paranoic-blocked-ids-v1';

function readLocalIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

function writeLocalIds(key: string, ids: Set<string>): void {
  localStorage.setItem(key, JSON.stringify([...ids]));
}

export function readLocalRelations(): PeerRelations {
  return {
    trusted: readLocalIds(TRUSTED_KEY),
    blocked: readLocalIds(BLOCKED_KEY),
  };
}

export function writeLocalRelations(relations: PeerRelations): void {
  writeLocalIds(TRUSTED_KEY, relations.trusted);
  writeLocalIds(BLOCKED_KEY, relations.blocked);
}

/** Pull cloud relations; merge with local (cloud wins on conflict). */
export async function syncRelationsFromCloud(): Promise<PeerRelations> {
  const local = readLocalRelations();
  if (!hasSupabaseConfig()) return local;

  try {
    await ensureAuthSession().catch(() => undefined);
    const uid = await getAuthUserId();
    if (!uid) return local;

    const sb = getSupabase();
    const { data, error } = await sb
      .from(USER_PEER_RELATIONS_TABLE)
      .select('peer_id,relation')
      .eq('owner_id', uid);

    if (error) {
      console.warn('[paranoic trust] cloud fetch', error.message);
      return local;
    }

    const trusted = new Set<string>();
    const blocked = new Set<string>();
    for (const row of (data as Array<{ peer_id?: string; relation?: string }> | null) ?? []) {
      const peerId = row.peer_id;
      if (!peerId) continue;
      if (row.relation === 'blocked') blocked.add(peerId);
      else if (row.relation === 'trusted') trusted.add(peerId);
    }

    // First login: upload any local-only entries to cloud.
    if (trusted.size === 0 && blocked.size === 0 && (local.trusted.size > 0 || local.blocked.size > 0)) {
      await pushRelationsToCloud(local);
      writeLocalRelations(local);
      return local;
    }

    writeLocalRelations({ trusted, blocked });
    return { trusted, blocked };
  } catch (e) {
    console.warn('[paranoic trust] sync failed', e);
    return local;
  }
}

async function pushRelationsToCloud(relations: PeerRelations): Promise<void> {
  if (!hasSupabaseConfig()) return;
  const uid = await getAuthUserId();
  if (!uid) return;

  const sb = getSupabase();
  const rows: Array<{ owner_id: string; peer_id: string; relation: string }> = [];
  for (const peerId of relations.trusted) {
    rows.push({ owner_id: uid, peer_id: peerId, relation: 'trusted' });
  }
  for (const peerId of relations.blocked) {
    if (!relations.trusted.has(peerId)) {
      rows.push({ owner_id: uid, peer_id: peerId, relation: 'blocked' });
    }
  }
  if (rows.length === 0) return;

  const { error } = await sb.from(USER_PEER_RELATIONS_TABLE).upsert(rows, {
    onConflict: 'owner_id,peer_id',
  });
  if (error) console.warn('[paranoic trust] cloud push', error.message);
}

export async function setCloudRelation(
  peerId: string,
  relation: 'trusted' | 'blocked' | null
): Promise<PeerRelations> {
  const current = readLocalRelations();

  if (relation === 'trusted') {
    current.trusted.add(peerId);
    current.blocked.delete(peerId);
  } else if (relation === 'blocked') {
    current.blocked.add(peerId);
    current.trusted.delete(peerId);
  } else {
    current.trusted.delete(peerId);
    current.blocked.delete(peerId);
  }

  writeLocalRelations(current);

  if (!hasSupabaseConfig()) return current;

  try {
    const uid = await getAuthUserId();
    if (!uid) return current;
    const sb = getSupabase();

    if (relation == null) {
      await sb
        .from(USER_PEER_RELATIONS_TABLE)
        .delete()
        .eq('owner_id', uid)
        .eq('peer_id', peerId);
    } else {
      await sb.from(USER_PEER_RELATIONS_TABLE).upsert(
        { owner_id: uid, peer_id: peerId, relation },
        { onConflict: 'owner_id,peer_id' }
      );
    }
  } catch (e) {
    console.warn('[paranoic trust] cloud set', e);
  }

  return current;
}
