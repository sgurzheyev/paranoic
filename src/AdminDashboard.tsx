import { useEffect, useMemo, useState } from 'react';
import { Ban, RefreshCw, Search, Shield, Trash2, X } from 'lucide-react';
import Avatar from './Avatar';
import {
  deleteUserAccount,
  listAllProfiles,
  setUserBanned,
  type AdminUserRow,
} from './admin';

type AdminDashboardProps = {
  currentUserId: string;
  onClose: () => void;
};

export default function AdminDashboard({ currentUserId, onClose }: AdminDashboardProps) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await listAllProfiles();
      setUsers(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const uname = (u.username || '').toLowerCase();
      const name = (u.name || '').toLowerCase();
      const id = u.id.toLowerCase();
      return uname.includes(q) || name.includes(q) || id.includes(q);
    });
  }, [users, query]);

  const toggleBan = async (user: AdminUserRow) => {
    if (user.id === currentUserId) {
      setError('Нельзя забанить свой аккаунт');
      return;
    }
    setBusyId(user.id);
    setError('');
    try {
      const next = !user.is_banned;
      await setUserBanned(user.id, next);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_banned: next } : u))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось изменить бан');
    } finally {
      setBusyId(null);
    }
  };

  const removeUser = async (user: AdminUserRow) => {
    if (user.id === currentUserId) {
      setError('Нельзя удалить свой аккаунт из панели');
      return;
    }
    const label = user.username ? `@${user.username}` : user.id;
    if (!window.confirm(`Удалить аккаунт ${label} безвозвратно?`)) return;
    setBusyId(user.id);
    setError('');
    try {
      await deleteUserAccount(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-dash-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-dash"
        role="dialog"
        aria-labelledby="admin-dash-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-dash-head">
          <div className="admin-dash-title-row">
            <Shield size={16} />
            <h2 id="admin-dash-title">Admin Panel</h2>
          </div>
          <div className="admin-dash-head-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={() => void load()}
              aria-label="Обновить"
              disabled={loading}
            >
              <RefreshCw size={18} className={loading ? 'spin' : undefined} />
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
              <X size={16} />
            </button>
          </div>
        </div>

        <p className="admin-dash-lead">
          Пользователи из Supabase · бан блокирует call_offer и P2P
        </p>

        <label className="admin-dash-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по username / ID / имени"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        {error && (
          <p className="admin-dash-error" role="alert">
            {error}
          </p>
        )}

        <div className="admin-dash-list">
          {loading && users.length === 0 ? (
            <p className="admin-dash-empty">Загрузка…</p>
          ) : filtered.length === 0 ? (
            <p className="admin-dash-empty">Никого не найдено</p>
          ) : (
            filtered.map((user) => {
              const busy = busyId === user.id;
              const handle = user.username ? `@${user.username}` : 'без никнейма';
              return (
                <article
                  key={user.id}
                  className={`admin-user-card${user.is_banned ? ' banned' : ''}`}
                >
                  <div className="admin-user-main">
                    <Avatar
                      name={user.name || user.username || user.id}
                      color={user.color}
                      avatarUrl={user.avatar_url}
                      size="md"
                    />
                    <div className="admin-user-meta">
                      <div className="admin-user-name-row">
                        <strong>{handle}</strong>
                        <span
                          className={`admin-status-pill ${user.is_banned ? 'banned' : 'active'}`}
                        >
                          {user.is_banned ? 'Banned' : 'Active'}
                        </span>
                        {user.role === 'admin' && (
                          <span className="admin-role-pill">admin</span>
                        )}
                      </div>
                      <p className="admin-user-id mono-box">{user.id}</p>
                      {user.name && user.name !== 'Я' && (
                        <p className="admin-user-display">{user.name}</p>
                      )}
                    </div>
                  </div>

                  <div className="admin-user-actions">
                    <button
                      type="button"
                      className={`admin-ban-btn${user.is_banned ? ' unban' : ''}`}
                      disabled={busy || user.id === currentUserId}
                      onClick={() => void toggleBan(user)}
                    >
                      <Ban size={15} />
                      {user.is_banned ? 'Unban' : 'Ban User'}
                    </button>
                    <button
                      type="button"
                      className="admin-delete-btn"
                      disabled={busy || user.id === currentUserId}
                      onClick={() => void removeUser(user)}
                    >
                      <Trash2 size={15} />
                      Delete Account
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
