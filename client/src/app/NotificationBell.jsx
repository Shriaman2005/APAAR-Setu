import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/apiClient';
import { Icon, formatDate } from '../components/ui';
import { usePreferences } from '../features/preferences/PreferencesContext';

// In-app (demo) notifications. Polls every minute while signed in.
export default function NotificationBell() {
  const { t } = usePreferences();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unreadCount: 0 });
  const [error, setError] = useState(null);
  const wrapperRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api('/notifications?pageSize=6'));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    function close(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function openNotification(item) {
    try {
      if (!item.readAt) await api(`/notifications/${item._id}/read`, { method: 'POST' });
    } catch {
      /* opening still works if marking as read fails */
    }
    setOpen(false);
    load();
    if (item.link) navigate(item.link);
  }

  return (
    <div className="position-relative" ref={wrapperRef}>
      <button type="button" className="btn btn-outline-primary btn-icon-only position-relative" style={{ minWidth: 44 }} aria-expanded={open} aria-haspopup="true" onClick={() => { setOpen((v) => !v); if (!open) load(); }} aria-label={`${t('notifications')}: ${data.unreadCount} unread`}>
        <Icon name="bell" />
        {data.unreadCount > 0 && <span className="bell-count">{data.unreadCount > 9 ? '9+' : data.unreadCount}</span>}
      </button>
      {open && (
        <div className="position-absolute end-0 mt-1 bg-white border rounded shadow p-2" style={{ width: 340, zIndex: 1000 }} role="region" aria-label={t('notifications')}>
          <div className="d-flex justify-content-between align-items-center px-1 mb-1">
            <strong>{t('notifications')}</strong>
            <Link to="/notifications" onClick={() => setOpen(false)} className="small">View all</Link>
          </div>
          {error && <p className="small text-danger px-1 mb-1">Could not load notifications: {error.message}</p>}
          {data.items.length === 0 && !error && <p className="small text-muted px-1 mb-1">No notifications.</p>}
          <ul className="list-unstyled mb-0">
            {data.items.map((item) => (
              <li key={item._id}>
                <button type="button" className={`btn btn-link text-start w-100 text-decoration-none p-1 ${item.readAt ? 'text-muted' : 'fw-semibold'}`} style={{ minWidth: 0 }} onClick={() => openNotification(item)}>
                  <span className="d-block small">{item.safeMessage}</span>
                  <span className="d-block small text-muted">{formatDate(item.createdAt, true)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
