import { Link } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { DataState, DataTable, Icon, KpiTile, PageHeader, SeatBar, StatusBadge, SyntheticTag, formatDate } from '../../components/ui';

export default function CollegeDashboard() {
  const { user } = useAuth();
  const isOperator = user.role === 'COLLEGE_OPERATOR';
  useDocumentTitle(isOperator ? 'Operator dashboard' : 'College head dashboard');
  const dashboard = useApi(() => api('/dashboard/college'), []);
  const data = dashboard.data;

  return (
    <>
      <PageHeader
        title={isOperator ? 'Operator dashboard' : 'College head dashboard'}
        subtitle={data ? `${data.institution.name} (${data.institution.code}) - academic year ${data.academicYear}` : user.institution?.name}
        onRefresh={dashboard.reload}
        refreshing={dashboard.loading}
        actions={isOperator
          ? <Link className="btn btn-primary" to="/college/upload"><Icon name="cloud-upload" />Upload batch</Link>
          : <Link className="btn btn-primary" to="/college/batches?status=READY_FOR_REVIEW"><Icon name="person-check" />Pending submissions</Link>}
      />
      <DataState loading={dashboard.loading} error={dashboard.error} onRetry={dashboard.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <div className="mb-2"><SyntheticTag /></div>
            <div className="row g-3 mb-3">
              <div className="col-6 col-lg-3"><KpiTile label="Active enrolments" value={data.kpis.activeEnrolments} /></div>
              <div className="col-6 col-lg-3"><KpiTile label={`Seats filled of ${data.kpis.seatCapacity}`} value={`${data.kpis.seatsFilled} (${data.kpis.utilisationPct}%)`} /></div>
              {isOperator ? (
                <div className="col-6 col-lg-3"><KpiTile label="Batches needing correction" value={data.kpis.batchesNeedingCorrection} status={data.kpis.batchesNeedingCorrection ? 'warning' : undefined} /></div>
              ) : (
                <div className="col-6 col-lg-3"><KpiTile label="Awaiting your review" value={data.kpis.batchesAwaitingReview} status={data.kpis.batchesAwaitingReview ? 'warning' : undefined} /></div>
              )}
              <div className="col-6 col-lg-3"><KpiTile label="Open conflict cases" value={data.kpis.openConflicts} status={data.kpis.openConflicts ? 'danger' : undefined} /></div>
              {!isOperator && (
                <>
                  <div className="col-6 col-lg-3"><KpiTile label="Returned for correction" value={data.kpis.batchesReturned} /></div>
                  <div className="col-6 col-lg-3"><KpiTile label="Certified and committed" value={data.kpis.batchesCommitted} status="success" /></div>
                </>
              )}
              <div className="col-6 col-lg-3"><KpiTile label="Student correction requests" value={data.kpis.pendingCorrectionRequests} /></div>
            </div>

            <div className="row g-3">
              <div className="col-lg-6">
                <section className="card-gov">
                  <h2>Recent batches</h2>
                  {data.recentBatches.length === 0 ? <p className="text-muted mb-0">No batches yet.</p> : (
                    <DataTable
                      rowKey={(row) => row.batchId}
                      columns={[
                        { key: 'batchId', header: 'Batch', render: (row) => <Link to={`/college/batches/${row.batchId}`}>{row.batchId}</Link> },
                        { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
                        { key: 'totalRows', header: 'Rows', numeric: true },
                        { key: 'createdAt', header: 'Uploaded', render: (row) => formatDate(row.createdAt) },
                      ]}
                      rows={data.recentBatches}
                    />
                  )}
                </section>
              </div>
              <div className="col-lg-6">
                <section className="card-gov">
                  <h2>Seat ledger ({data.academicYear})</h2>
                  <DataTable
                    rowKey={(row) => `${row.courseCode}-${row.bucketCode}`}
                    columns={[
                      { key: 'courseCode', header: 'Course' },
                      { key: 'bucketCode', header: 'Bucket' },
                      { key: 'usage', header: 'Filled / capacity', render: (row) => <SeatBar filled={row.filled} capacity={row.capacity} /> },
                      { key: 'remaining', header: 'Remaining', numeric: true },
                    ]}
                    rows={data.ledger.filter((row) => row.inActivePolicy)}
                  />
                  <p className="small text-muted mt-2 mb-0">Policy {data.ledger[0]?.policyVersion || '-'} - {data.ledger[0]?.sourceType || ''}. <Link to="/college/seat-ledger">Full seat ledger</Link></p>
                </section>
              </div>
            </div>
            <p className="small text-muted mt-3">Generated {formatDate(data.generatedAt, true)} from the database.</p>
          </>
        )}
      </DataState>
    </>
  );
}
