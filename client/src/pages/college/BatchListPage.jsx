import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, toQuery } from '../../services/apiClient';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { Button, DataState, DataTable, Icon, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';

const STATUSES = ['UPLOADED', 'VALIDATING', 'NEEDS_CORRECTION', 'VALIDATED', 'READY_FOR_REVIEW', 'RETURNED_FOR_CORRECTION', 'COMMITTING', 'COMMITTED', 'COMMIT_FAILED', 'DISCARDED'];

export default function BatchListPage() {
  const { user } = useAuth();
  const isOperator = user.role === 'COLLEGE_OPERATOR';
  useDocumentTitle(isOperator ? 'Admission batches' : 'Submissions');
  const [params, setParams] = useSearchParams();
  const [searchText, setSearchText] = useState(params.get('search') || '');
  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);
  const search = params.get('search') || '';
  const list = useApi(() => api(`/batches${toQuery({ status, page, search })}`), [status, page, search]);

  function update(next) {
    const merged = { status, search, page: 1, ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== '' && v !== undefined && v !== null)));
  }

  return (
    <>
      <PageHeader
        title={isOperator ? 'Admission batches' : 'Submissions for review'}
        subtitle="Batches of your institution only."
        onRefresh={list.reload}
        refreshing={list.loading}
        actions={isOperator && <Link className="btn btn-primary" to="/college/upload"><Icon name="cloud-upload" />Upload batch</Link>}
      />
      <form className="row g-2 align-items-end mb-3" onSubmit={(e) => { e.preventDefault(); update({ search: searchText.trim() }); }}>
        <div className="col-sm-4">
          <label className="form-label" htmlFor="batch-status">Status</label>
          <select id="batch-status" className="form-select" value={status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ').toLowerCase()}</option>)}
          </select>
        </div>
        <div className="col-sm-5">
          <label className="form-label" htmlFor="batch-search">Search batch ID or file name</label>
          <input id="batch-search" className="form-control" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <div className="col-sm-3 d-flex gap-2">
          <Button type="submit" icon="search">Search</Button>
          <Button variant="link" onClick={() => { setSearchText(''); setParams({}); }}>Clear filters</Button>
        </div>
      </form>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No batches match" emptyText={isOperator ? 'Upload a CSV file to create a batch.' : 'Nothing is waiting for you.'}>
        {list.data && (
          <>
            <DataTable
              caption="Admission batches"
              rowKey={(row) => row.batchId}
              columns={[
                { key: 'batchId', header: 'Batch ID', render: (row) => <Link to={`/college/batches/${row.batchId}`}>{row.batchId}</Link> },
                { key: 'sourceFileName', header: 'File' },
                { key: 'academicYear', header: 'Year' },
                { key: 'status', header: 'Status', render: (row) => <><StatusBadge status={row.status} />{row.revalidationRequired && <span className="small text-muted d-block">revalidation required</span>}</> },
                { key: 'rows', header: 'Rows', numeric: true, render: (row) => row.counts?.totalRows ?? 0 },
                { key: 'errors', header: 'Open errors', numeric: true, render: (row) => row.counts?.openErrors ?? 0 },
                { key: 'warnings', header: 'Warnings', numeric: true, render: (row) => row.counts?.warnings ?? 0 },
                { key: 'updatedAt', header: 'Last updated', render: (row) => formatDate(row.updatedAt, true) },
              ]}
              rows={list.data.items}
            />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => update({ page: p })} />
          </>
        )}
      </DataState>
    </>
  );
}
