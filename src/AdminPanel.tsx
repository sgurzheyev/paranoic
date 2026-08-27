import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban,
  CheckCircle2,
  Flag,
  MapPin,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import Avatar from './Avatar';
import type { AdminUserRow } from './admin';
import {
  banUserForModeration,
  deleteCapsuleAsAdmin,
  deleteReportedUserContent,
  isSuperAdminUsername,
  listModerationReports,
  listModerationUsers,
  listPublicCapsules,
  markReportResolved,
  unbanUserForModeration,
  type AdminCapsule,
  type ModerationReport,
} from './adminModeration';

type AdminPanelProps = {
  username?: string | null;
  currentUserId: string;
  onClose: () => void;
};

type TabId = 'users' | 'capsules' | 'reports';

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'users', label: 'Пользователи', icon: Users },
  { id: 'capsules', label: 'Капсулы', icon: MapPin },
  { id: 'reports', label: 'Жалобы', icon: Flag },
];

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function formatWhen(iso: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16);
  }
}

/**
 * UGC moderation console — client-gated to @sgurzheyev only.
 */
export default function AdminPanel({ username, currentUserId, onClose }: AdminPanelProps) {
  const allowed = isSuperAdminUsername(username);

  const [tab, setTab] = useState<TabId>('users');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [capsules, setCapsules] = useState<AdminCapsule[]>([]);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const rows = await listModerationUsers();
    setUsers(rows);
  }, []);

  const loadCapsules = useCallback(async () => {
    const rows = await listPublicCapsules();
    setCapsules(rows);
  }, []);

  const loadReports = useCallback(async () => {
    const rows = await listModerationReports();
    setReports(rows);
  }, []);

  const refresh = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      if (tab === 'users') await loadUsers();
      else if (tab === 'capsules') await loadCapsules();
      else await loadReports();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [allowed, tab, loadUsers, loadCapsules, loadReports]);

  useEffect(() => {
    if (!allowed) return;
    void refresh();
  }, [allowed, refresh]);

  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allowed, onClose]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = `${u.username || ''} ${u.name || ''} ${u.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [users, query]);

  const filteredCapsules = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return capsules;
    return capsules.filter((c) => {
      const hay = `${c.content} ${c.author_id} ${c.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [capsules, query]);

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => {
      const hay = `${r.reason} ${r.reporter_id} ${r.reported_id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [reports, query]);

  if (!allowed || typeof document === 'undefined') return null;

  const banUser = async (user: AdminUserRow) => {
    if (user.id === currentUserId) {
      setError('Нельзя заблокировать свой аккаунт');
      return;
    }
    const label = user.username ? `@${user.username}` : user.id;
    if (user.is_banned) {
      if (!window.confirm(`Разбанить ${label}?`)) return;
      setBusyId(user.id);
      setError('');
      try {
        await unbanUserForModeration(user.id);
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, is_banned: false } : u))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось разбанить');
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (
      !window.confirm(
        `Заблокировать ${label}? Пользователь будет забанен в profiles и добавлен в blocked_users.`
      )
    ) {
      return;
    }
    setBusyId(user.id);
    setError('');
    try {
      await banUserForModeration(user.id);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_banned: true } : u))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось забанить');
      // refresh in case profiles ban succeeded partially
      void loadUsers();
    } finally {
      setBusyId(null);
    }
  };

  const removeCapsule = async (capsule: AdminCapsule) => {
    if (
      !window.confirm(
        'Удалить эту капсулу безвозвратно? Это действие необратимо.'
      )
    ) {
      return;
    }
    setBusyId(capsule.id);
    setError('');
    try {
      await deleteCapsuleAsAdmin(capsule);
      setCapsules((prev) => prev.filter((c) => c.id !== capsule.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить капсулу');
    } finally {
      setBusyId(null);
    }
  };

  const resolveReport = async (report: ModerationReport) => {
    if (!window.confirm('Пометить жалобу как решённую?')) return;
    setBusyId(report.id);
    setError('');
    try {
      await markReportResolved(report.id);
      setReports((prev) =>
        prev.map((r) =>
          r.id === report.id ? { ...r, resolved_at: new Date().toISOString() } : r
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обновить жалобу');
    } finally {
      setBusyId(null);
    }
  };

  const purgeReportedContent = async (report: ModerationReport) => {
    if (
      !window.confirm(
        `Удалить публичный контент пользователя ${shortId(report.reported_id)}? Это необратимо.`
      )
    ) {
      return;
    }
    setBusyId(report.id);
    setError('');
    try {
      const n = await deleteReportedUserContent(report.reported_id);
      await markReportResolved(report.id);
      setReports((prev) =>
        prev.map((r) =>
          r.id === report.id ? { ...r, resolved_at: new Date().toISOString() } : r
        )
      );
      setCapsules((prev) => prev.filter((c) => c.author_id !== report.reported_id));
      window.alert(`Удалено капсул: ${n}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить контент');
    } finally {
      setBusyId(null);
    }
  };

  const searchPlaceholder =
    tab === 'users'
      ? 'Поиск: username / ID / имя'
      : tab === 'capsules'
        ? 'Поиск: текст / автор / id'
        : 'Поиск: причина / id';

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 backdrop-blur-md sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[min(960px,100dvh)] w-full max-w-3xl flex-col overflow-hidden rounded-t-[22px] border border-white/10 bg-[#0a0c12] shadow-[0_-16px_60px_rgba(0,0,0,0.55)] sm:rounded-[22px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200">
            <Shield size={18} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="admin-panel-title"
              className="truncate text-[1.05rem] font-bold tracking-tight text-slate-50"
            >
              Центр модерации (UGC Moderation)
            </h2>
            <p className="truncate text-[0.72rem] text-slate-500">
              Доступ: @{username?.replace(/^@+/, '') || '—'}
            </p>
          </div>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/[0.08]"
            onClick={() => void refresh()}
            aria-label="Обновить"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin' : undefined} />
          </button>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/[0.08]"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 border-b border-white/[0.06] px-3 py-2">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setQuery('');
                  setTab(item.id);
                }}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[0.78rem] font-semibold transition ${
                  active
                    ? 'bg-white/[0.1] text-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                }`}
              >
                <Icon size={14} aria-hidden />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 px-4 pt-3">
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
            <Search size={15} className="shrink-0 text-slate-500" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-[0.84rem] text-slate-100 outline-none placeholder:text-slate-600"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          {error ? (
            <p className="mt-2 text-[0.78rem] font-medium text-rose-300" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {tab === 'users' && (
            <div className="space-y-2">
              {loading && users.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Загрузка…</p>
              ) : filteredUsers.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Пользователи не найдены</p>
              ) : (
                filteredUsers.map((user) => {
                  const handle = user.username ? `@${user.username}` : 'без ника';
                  const busy = busyId === user.id;
                  return (
                    <article
                      key={user.id}
                      className={`flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:flex-row sm:items-center ${
                        user.is_banned ? 'border-rose-400/25 bg-rose-500/[0.06]' : ''
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar
                          name={user.name || user.username || user.id}
                          color={user.color}
                          avatarUrl={user.avatar_url}
                          size="md"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <strong className="text-[0.9rem] text-slate-100">{handle}</strong>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${
                                user.is_banned
                                  ? 'bg-rose-500/20 text-rose-200'
                                  : 'bg-emerald-500/15 text-emerald-200'
                              }`}
                            >
                              {user.is_banned ? 'Banned' : 'Active'}
                            </span>
                            {user.role === 'admin' ? (
                              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-amber-200">
                                admin
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[0.7rem] text-slate-500">
                            {user.id}
                          </p>
                          {user.name && user.name !== 'Я' ? (
                            <p className="truncate text-[0.75rem] text-slate-400">{user.name}</p>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy || user.id === currentUserId}
                        onClick={() => void banUser(user)}
                        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.75rem] font-semibold transition disabled:opacity-40 ${
                          user.is_banned
                            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                            : 'border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                        }`}
                      >
                        <Ban size={13} aria-hidden />
                        {user.is_banned ? 'Разбанить' : 'Заблокировать (Ban)'}
                      </button>
                    </article>
                  );
                })
              )}
            </div>
          )}

          {tab === 'capsules' && (
            <div className="space-y-2">
              {loading && capsules.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Загрузка…</p>
              ) : filteredCapsules.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Публичных капсул нет</p>
              ) : (
                filteredCapsules.map((c) => {
                  const busy = busyId === c.id;
                  return (
                    <article
                      key={`${c.source}:${c.id}`}
                      className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:flex-row sm:items-start"
                    >
                      {c.media_url ? (
                        <a
                          href={c.media_url}
                          target="_blank"
                          rel="noreferrer"
                          className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40"
                        >
                          <img
                            src={c.media_url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/40 text-slate-500">
                          <MapPin size={18} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.88rem] font-semibold leading-snug text-slate-100">
                          {c.content || '—'}
                        </p>
                        <p className="mt-1 font-mono text-[0.7rem] text-slate-500">
                          author: {shortId(c.author_id)} · {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
                        </p>
                        <p className="mt-0.5 text-[0.7rem] text-slate-600">
                          {c.source} · {c.visibility} · {formatWhen(c.created_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeCapsule(c)}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[0.75rem] font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-40"
                      >
                        <Trash2 size={13} aria-hidden />
                        Удалить
                      </button>
                    </article>
                  );
                })
              )}
            </div>
          )}

          {tab === 'reports' && (
            <div className="space-y-2">
              {loading && reports.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Загрузка…</p>
              ) : filteredReports.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Жалоб пока нет</p>
              ) : (
                filteredReports.map((r) => {
                  const busy = busyId === r.id;
                  const done = Boolean(r.resolved_at);
                  return (
                    <article
                      key={r.id}
                      className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 ${
                        done ? 'opacity-70' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Flag size={14} className="text-amber-300" aria-hidden />
                        <span className="text-[0.8rem] font-semibold text-slate-200">
                          {shortId(r.reporter_id)} → {shortId(r.reported_id)}
                        </span>
                        {done ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-emerald-200">
                            Решено
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-amber-200">
                            Open
                          </span>
                        )}
                        <span className="ml-auto text-[0.7rem] text-slate-600">
                          {formatWhen(r.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 text-[0.84rem] leading-relaxed text-slate-300">
                        {r.reason}
                      </p>
                      {!done ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void purgeReportedContent(r)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[0.72rem] font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-40"
                          >
                            <Trash2 size={12} aria-hidden />
                            Удалить контент
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void resolveReport(r)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[0.72rem] font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-40"
                          >
                            <CheckCircle2 size={12} aria-hidden />
                            Пометить как решено
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
