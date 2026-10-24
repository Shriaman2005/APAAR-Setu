import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, toQuery } from '../../services/apiClient';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { Alert, DataState, DataTable, PageHeader, SeatBar, StatusBadge } from '../../components/ui';

// Read-only seat ledger. College users see their own institution; officers open it from a dashboard.
export default function SeatLedgerPage() {
  const { user } = useAuth();
  const params = useParams();
  const institutionId = params.institutionId || user.institution?.id;
  const [academicYear, setAcademicYear] = useState('2026-27');
  useDocumentTitle('Seat ledger');
  const ledger = useApi(() => api(`/institutions/${institutionId}/seat-ledger${toQuery({ academicYear })}`), [institutionId, academicYear]);

  return (
    <>
      <PageHeader
        title="Seat ledger"
        subtitle={ledger.data ? `${ledger.data.institution.name} (${ledger.data.institution.code}) - region ${ledger.data.institution.regionId}` : null}
        onRefresh={ledger.reload}
        refreshing={ledger.loading}
      />
      <div className="row g-2 mb-3">
        <div className="col-sm-4 col-md-3">
          <label className="form-label" htmlFor="ledger-year">Academic year</label>
          <select id="ledger-year" className="form-select" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}>
            <option value="2026-27">2026-27</option>
            <option value="">All years</option>
          </select>
        </div>
      </div>
      <DataState loading={ledger.loading} error={ledger.error} onRetry={ledger.reload} hasData={Boolean(ledger.data)} empty={ledger.data?.buckets.length === 0} emptyTitle="No seat ledger configured for this selection">
        {ledger.data && (
          <>
            <Alert kind="warning" className="mb-3">{ledger.data.note}</Alert>
            <DataTable
              caption="Seat ledger by course and bucket"
              rowKey={(row) => `${row.courseCode}-${row.bucketCode}-${row.policyVersion}`}
              columns={[
                { key: 'courseCode', header: 'Course', render: (row) => <>{row.courseCode}<div className="small text-muted">{row.programName}</div></> },
                { key: 'bucketCode', header: 'Bucket' },
                { key: 'countsWithinIntake', header: 'Counts within intake?', render: (row) => (row.countsWithinIntake ? `Yes (intake ${row.approvedIntake})` : 'No - additional seats') },
                { key: 'usage', header: 'Filled / capacity', render: (row) => <SeatBar filled={row.filled} capacity={row.capacity} /> },
                { key: 'remaining', header: 'Remaining', numeric: true },
                { key: 'policyVersion', header: 'Policy', render: (row) => <>{row.policyVersion}<div className="small text-muted">{row.sourceType}</div></> },
                { key: 'inActivePolicy', header: 'In active policy', render: (row) => <StatusBadge status={row.inActivePolicy ? 'ACTIVE' : 'SUPERSEDED'} label={row.inActivePolicy ? 'Yes' : 'No'} /> },
              ]}
              rows={ledger.data.buckets}
            />
          </>
        )}
      </DataState>
    </>
  );
}
