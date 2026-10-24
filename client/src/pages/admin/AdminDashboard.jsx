import { Link } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { Alert, DataState, DataTable, KpiTile, PageHeader, StatusBadge, SyntheticTag, formatDate } from '../../components/ui';
import { ROLE_LABELS } from '../../features/auth/AuthContext';

export default function AdminDashboard() {
  useDocumentTitle('Administration dashboard');
  const dashboard = useApi(() => api('/dashboard/admin'), []);
  const data = dashboard.data;
  return (
    <>
      <PageHeader title="Administration dashboard" subtitle="Accounts, organisations, seat-policy versions and system checks. Administrators cannot certify batches." onRefresh={dashboard.reload} refreshing={dashboard.loading} />
      <DataState loading={dashboard.loading} error={dashboard.error} onRetry={dashboard.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <div className="mb-2"><SyntheticTag /></div>
            <div className="row g-3 mb-3">
              <div className="col-6 col-lg-3"><KpiTile label="Active accounts" value={data.usersByStatus.ACTIVE || 0} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="Pending activation" value={data.usersByStatus.PENDING_ACTIVATION || 0} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="Organisations awaiting approval" value={data.pendingOrganisations} status={data.pendingOrganisations ? 'warning' : undefined} hint={<Link to="/admin/organisations">Review organisations</Link>} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="Audit events recorded" value={data.auditEvents} /></div>
            </div>
            <div className="row g-3">
              <div className="col-lg-6">
                <section className="card-gov">
                  <h2>Accounts by role</h2>
                  <DataTable rowKey={(r) => r.role} columns={[{ key: 'label', header: 'Role' }, { key: 'count', header: 'Accounts', numeric: true }]}
                    rows={Object.entries(data.usersByRole).map(([role, count]) => ({ role, label: ROLE_LABELS[role] || role, count }))} />
                  <p className="mt-2 mb-0"><Link to="/admin/users">Manage users</Link></p>
                </section>
              </div>
              <div className="col-lg-6">
                <section className="card-gov">
                  <h2>System checks</h2>
                  {data.ledgerReconciliation.consistent
                    ? <Alert kind="success" className="mb-2">Seat ledger counters match enrolments ({data.ledgerReconciliation.checkedLedgers} ledger rows).</Alert>
                    : <Alert kind="error" className="mb-2">{data.ledgerReconciliation.mismatches} ledger mismatch(es) found. <Link to="/admin/ledger-check">Inspect</Link></Alert>}
                  {data.lastAuditVerification
                    ? <Alert kind={data.lastAuditVerification.status === 'PASS' ? 'success' : 'error'} className="mb-2">Last audit chain check: <StatusBadge status={data.lastAuditVerification.status} /> ({data.lastAuditVerification.checkedEvents} events) on {formatDate(data.lastAuditVerification.at, true)}.</Alert>
                    : <Alert kind="info" className="mb-2">The audit chain has not been verified yet. <Link to="/admin/audit">Open the audit explorer</Link></Alert>}
                  <h3 className="mt-3">Demo settings</h3>
                  <ul className="mb-0">
                    <li>Mock identity service: <strong>{data.settings.mockIdentityServiceMode}</strong></li>
                    <li>Pending identity policy: <strong>{data.settings.pendingIdentityPolicy}</strong></li>
                    <li>Conflict review target: <strong>{data.settings.conflictReviewSlaDays} days</strong></li>
                  </ul>
                  <p className="mt-2 mb-0"><Link to="/admin/settings">Change settings</Link></p>
                </section>
              </div>
              <div className="col-12">
                <section className="card-gov">
                  <h2>Seat policy versions</h2>
                  <DataTable rowKey={(r) => r.id} rows={data.policies} columns={[
                    { key: 'version', header: 'Version', render: (r) => <Link to={`/admin/policies/${r.id}`}>{r.version}</Link> },
                    { key: 'academicYear', header: 'Academic year' },
                    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                    { key: 'sourceType', header: 'Source' },
                    { key: 'approvedAt', header: 'Approved', render: (r) => formatDate(r.approvedAt, true) },
                  ]} />
                </section>
              </div>
            </div>
          </>
        )}
      </DataState>
    </>
  );
}
