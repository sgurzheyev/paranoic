import {
  ensureAuthSession,
  getAuthUserId,
  getSupabase,
  hasSupabaseConfig,
} from './lib/supabase';
import { PROFILE_PUBLIC_COLUMNS, PROFILES_TABLE } from './profile';

export const GEM_LIKES_TABLE = 'gem_likes';
export const GEM_COMMENTS_TABLE = 'gem_comments';

export type GemAuthorInfo = {
  name: string;
  avatarUrl?: string;
  color?: string;
};

export type GemComment = {
  id: string;
  gem_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author: GemAuthorInfo;
};

export type GemSocialSnapshot = {
  likeCount: number;
  liked: boolean;
  comments: GemComment[];
};

type ResolveAuthor = (userId: string) => GemAuthorInfo;

const DEFAULT_COLOR = '#60a5fa';

function fallbackAuthor(userId: string, resolve?: ResolveAuthor): GemAuthorInfo {
  const local = resolve?.(userId);
  if (local?.name) return { color: DEFAULT_COLOR, ...local };
  return { name: userId.slice(0, 10), color: DEFAULT_COLOR };
}

async function loadAuthors(
  userIds: string[],
  resolve?: ResolveAuthor
): Promise<Map<string, GemAuthorInfo>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, GemAuthorInfo>();
  for (const id of unique) {
    map.set(id, fallbackAuthor(id, resolve));
  }
  if (!hasSupabaseConfig() || unique.length === 0) return map;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(PROFILES_TABLE)
      .select(PROFILE_PUBLIC_COLUMNS)
      .in('id', unique);
    if (error || !data) return map;
    for (const row of data as Array<Record<string, unknown>>) {
      const id = String(row.id ?? '');
      if (!id) continue;
      const local = resolve?.(id);
      map.set(id, {
        name: local?.name || String(row.name || row.username || id.slice(0, 10)),
        avatarUrl:
          local?.avatarUrl ||
          (typeof row.avatar_url === 'string' ? row.avatar_url : undefined),
        color:
          local?.color ||
          (typeof row.color === 'string' ? row.color : DEFAULT_COLOR),
      });
    }
  } catch (e) {
    console.warn('[paranoic gem social] profiles', e);
  }
  return map;
}

function mapComment(
  row: Record<string, unknown>,
  authors: Map<string, GemAuthorInfo>,
  resolve?: ResolveAuthor
): GemComment {
  const userId = String(row.user_id ?? '');
  return {
    id: String(row.id),
    gem_id: String(row.gem_id),
    user_id: userId,
    content: String(row.content ?? ''),
    created_at: String(row.created_at ?? new Date().toISOString()),
    author: authors.get(userId) ?? fallbackAuthor(userId, resolve),
  };
}

export async function fetchGemSocial(
  gemId: string,
  currentUserId: string,
  resolveAuthor?: ResolveAuthor
): Promise<GemSocialSnapshot> {
  if (!hasSupabaseConfig()) {
    return { likeCount: 0, liked: false, comments: [] };
  }
  const sb = getSupabase();
  const [likesRes, commentsRes] = await Promise.all([
    sb.from(GEM_LIKES_TABLE).select('id,user_id').eq('gem_id', gemId),
    sb
      .from(GEM_COMMENTS_TABLE)
      .select('id,gem_id,user_id,content,created_at')
      .eq('gem_id', gemId)
      .order('created_at', { ascending: true })
      .limit(200),
  ]);

  if (likesRes.error) {
    console.warn('[paranoic gem social] likes', likesRes.error.message);
  }
  if (commentsRes.error) {
    console.warn('[paranoic gem social] comments', commentsRes.error.message);
  }

  const likeRows = (likesRes.data as Array<{ user_id?: string }> | null) ?? [];
  const commentRows = (commentsRes.data as Record<string, unknown>[] | null) ?? [];
  const authors = await loadAuthors(
    [...likeRows.map((r) => String(r.user_id ?? '')), ...commentRows.map((r) => String(r.user_id ?? ''))],
    resolveAuthor
  );

  return {
    likeCount: likeRows.length,
    liked: likeRows.some((r) => String(r.user_id) === currentUserId),
    comments: commentRows.map((row) => mapComment(row, authors, resolveAuthor)),
  };
}

export async function toggleGemLike(gemId: string, liked: boolean): Promise<boolean> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  await ensureAuthSession();
  const uid = await getAuthUserId();
  const sb = getSupabase();
  if (liked) {
    const { error } = await sb
      .from(GEM_LIKES_TABLE)
      .delete()
      .eq('gem_id', gemId)
      .eq('user_id', uid);
    if (error) throw new Error(error.message || 'Не удалось убрать лайк');
    return false;
  }
  const { error } = await sb.from(GEM_LIKES_TABLE).insert({
    gem_id: gemId,
    user_id: uid,
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return true;
    throw new Error(error.message || 'Не удалось поставить лайк');
  }
  return true;
}

export async function addGemComment(
  gemId: string,
  content: string,
  resolveAuthor?: ResolveAuthor
): Promise<GemComment> {
  const text = content.trim();
  if (!text) throw new Error('Введите комментарий');
  if (text.length > 500) throw new Error('Комментарий слишком длинный');
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');

  await ensureAuthSession();
  const uid = await getAuthUserId();
  const sb = getSupabase();
  const { data, error } = await sb
    .from(GEM_COMMENTS_TABLE)
    .insert({ gem_id: gemId, user_id: uid, content: text })
    .select('id,gem_id,user_id,content,created_at')
    .single();
  if (error) throw new Error(error.message || 'Не удалось отправить комментарий');
  const authors = await loadAuthors([uid], resolveAuthor);
  return mapComment(data as Record<string, unknown>, authors, resolveAuthor);
}

export function subscribeGemSocial(
  gemId: string,
  handlers: {
    onLikeChange?: () => void;
    onCommentInsert?: (row: Record<string, unknown>) => void;
    onCommentDelete?: (id: string) => void;
  }
): () => void {
  if (!hasSupabaseConfig()) return () => undefined;
  const sb = getSupabase();
  const channel = sb
    .channel(`gem-social:${gemId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: GEM_LIKES_TABLE, filter: `gem_id=eq.${gemId}` },
      () => handlers.onLikeChange?.()
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: GEM_COMMENTS_TABLE, filter: `gem_id=eq.${gemId}` },
      (payload) => {
        if (payload.new) handlers.onCommentInsert?.(payload.new as Record<string, unknown>);
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: GEM_COMMENTS_TABLE, filter: `gem_id=eq.${gemId}` },
      (payload) => {
        const id = (payload.old as { id?: string } | null)?.id;
        if (id) handlers.onCommentDelete?.(id);
      }
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}
