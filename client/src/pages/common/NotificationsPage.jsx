import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { Button, DataState, Pagination, PageHeader, formatDate } from '../../components/ui';

export default function NotificationsPage() {
  useDocumentTitle('Notifications');
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useApi(() => api(`/notifications${toQuery({ page, unread: unreadOnly ? 'true' : '' })}`), [page, unreadOnly]);
  const action = useAction();

  async function markAll() {
    await action.run(() => api('/notifications/read-all', { method: 'POST' }), { success: 'All notifications marked as read.' });
    list.reload();
  }
  async function markOne(id) {
    await action.run(() => api(`/notifications/${id}/read`, { method: 'POST' }));
    list.reload();
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="In-app demo notifications. No email or SMS is sent by this prototype."
        onRefresh={list.reload}
        refreshing={list.loading}
        actions={<Button variant="outline-primary" icon="check2-all" onClick={markAll} loading={action.busy} disabled={!list.data?.unreadCount} disabledReason="There are no unread notifications.">Mark all as read</Button>}
      />
      <div className="form-check mb-3">
        <input id="unread-only" type="checkbox" className="form-check-input" checked={unreadOnly} onChange={(e) => { setPage(1); setUnreadOnly(e.target.checked); }} />
        <label className="form-check-label" htmlFor="unread-only">Show unread only</label>
      </div>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No notifications">
        <ul className="list-group">
          {list.data?.items.map((item) => (
            <li key={item._id} className="list-group-item d-flex flex-wrap justify-content-between gap-2">
              <div>
                <div className={item.readAt ? '' : 'fw-semibold'}>{item.safeMessage}</div>
                <div className="small text-muted">{formatDate(item.createdAt, true)} {item.link && <>- <Link to={item.link}>Open</Link></>}</div>
              </div>
              {!item.readAt && <Button size="sm" variant="link" onClick={() => markOne(item._id)}>Mark as read</Button>}
            </li>
          ))}
        </ul>
        <Pagination page={list.data?.page} totalPages={list.data?.totalPages} total={list.data?.total} onPage={setPage} />
      </DataState>
    </>
  );
}
