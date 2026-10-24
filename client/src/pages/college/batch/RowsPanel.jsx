import { useState } from 'react';
import { api, toQuery } from '../../../services/apiClient';
import { useAction, useApi } from '../../../hooks/useApi';
import { ReasonDialog } from '../../../components/forms';
import { Button, DataState, Pagination, StatusBadge } from '../../../components/ui';

const ROW_STATUSES = ['VALID', 'HAS_ERRORS', 'HAS_WARNINGS', 'PENDING', 'STALE', 'EXCLUDED'];

export default function RowsPanel({ batchId, permissions, refreshKey, onChanged, onOpenRow }) {
  const [filters, setFilters] = useState({ status: '', search: '', page: 1 });
  const [searchText, setSearchText] = useState('');
  const list = useApi(() => api(`/batches/${batchId}/rows${toQuery(filters)}`), [batchId, filters, refreshKey]);
  const [excluding, setExcluding] = useState(null);
  const action = useAction();

  async function exclude(reason) {
    const done = await action.run(() => api(`/batches/${batchId}/rows/${excluding}/exclude`, { method: 'POST', body: { reason } }), { success: `Row ${excluding} excluded. Revalidate to update the results.` });
    if (done) { setExcluding(null); list.reload(); onChanged(); }
  }
  async function include(rowNumber) {
    const done = await action.run(() => api(`/batches/${batchId}/rows/${rowNumber}/include`, { method: 'POST' }), { success: `Row ${rowNumber} included again. Revalidate to update the results.` });
    if (done) { list.reload(); onChanged(); }
  }

  return (
    <>
      <form className="row g-2 align-items-end mb-2" onSubmit={(e) => { e.preventDefault(); setFilters((f) => ({ ...f, search: searchText.trim(), page: 1 })); }}>
        <div className="col-sm-3">
          <label className="form-label small" htmlFor="r-status">Row status</label>
          <select id="r-status" className="form-select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}>
            <option value="">All</option>{ROW_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
          </select>
        </div>
        <div className="col-sm-5">
          <label className="form-label small" htmlFor="r-search">Search row number, student code or name</label>
          <input id="r-search" className="form-control" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <div className="col-sm-4 d-flex gap-2">
          <Button type="submit" icon="search" size="sm">Search</Button>
          <Button variant="link" size="sm" onClick={() => { setSearchText(''); setFilters({ status: '', search: '', page: 1 }); }}>Clear filters</Button>
        </div>
      </form>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No rows match">
        {list.data && (
          <div className="table-responsive" style={{ maxHeight: '60vh' }}>
            <table className="table table-gov align-middle">
              <caption className="visually-hidden">Staged rows</caption>
              <thead><tr><th scope="col">Row</th><th scope="col">Student</th><th scope="col">Course / bucket</th><th scope="col">Demo ID</th><th scope="col">Identity (mock)</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {list.data.items.map((row) => (
                  <tr key={row.rowNumber} className={row.included ? '' : 'text-muted'}>
                    <td>{row.rowNumber}</td>
                    <td>{row.fields.studentCode || <em>missing</em>}<div className="small">{row.fields.studentName || <em>missing name</em>}</div></td>
                    <td>{row.fields.courseCode || <em>missing</em>} / {row.fields.bucketCode || <em>missing</em>}<div className="small text-muted">{row.fields.academicYear} - year {row.fields.yearOfStudy}</div></td>
                    <td className="mono">{row.fields.externalIdDemo || '-'}</td>
                    <td><StatusBadge status={row.identityCheck?.status || 'NOT_CHECKED'} /></td>
                    <td><StatusBadge status={row.validationStatus} />{row.correctionsCount > 0 && <div className="small text-muted">{row.correctionsCount} correction(s)</div>}</td>
                    <td className="text-nowrap">
                      <Button size="sm" variant="outline-primary" icon={permissions.canEditRows ? 'pencil' : 'eye'} onClick={() => onOpenRow(row.rowNumber)}>{permissions.canEditRows ? 'Edit row' : 'View'}</Button>
                      {permissions.canEditRows && (row.included
                        ? <Button size="sm" variant="link" onClick={() => setExcluding(row.rowNumber)}>Exclude</Button>
                        : <Button size="sm" variant="link" onClick={() => include(row.rowNumber)} loading={action.busy}>Include</Button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={list.data?.page} totalPages={list.data?.totalPages} total={list.data?.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </DataState>
      {excluding && (
        <ReasonDialog
          title={`Exclude row ${excluding} from this batch`}
          description="The row stays visible for the audit trail but will not be committed. Use this for duplicates or rows that cannot be corrected."
          label="Reason for excluding"
          confirmLabel="Exclude row"
          variant="danger"
          onSubmit={exclude}
          onClose={() => { setExcluding(null); action.setError(null); }}
          busy={action.busy}
          error={action.error}
        />
      )}
    </>
  );
}
