import { Link, useSearchParams } from 'react-router-dom';
import { api, downloadFile, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { Button, DataState, DataTable, KpiTile, PageHeader, SeatBar, SyntheticTag, formatDate } from '../../components/ui';

/**
 * National (all regions) or regional (assigned regions only) dashboard. The scope is enforced by
 * the API; editing the URL to another region returns 403.
 */
export default function AicteDashboard() {
  const { user } = useAuth();
  const regional = user.role === 'AICTE_REGIONAL_OFFICER';
  useDocumentTitle(regional ? 'Regional dashboard' : 'National dashboard');
  const [params, setParams] = useSearchParams();
  const filters = {
    academicYear: params.get('academicYear') || '',
    regionId: params.get('regionId') || '',
    stateCode: params.get('stateCode') || '',
    institutionId: params.get('institutionId') || '',
  };
  const endpoint = regional ? '/dashboard/aicte/region' : '/dashboard/aicte/national';
  const dashboard = useApi(() => api(`${endpoint}${toQuery(filters)}`), [endpoint, filters.academicYear, filters.regionId, filters.stateCode, filters.institutionId]);
  const exporter = useAction();
  const data = dashboard.data;

  function setFilter(next) {
    const merged = { ...filters, ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, value]) => value)));
  }

  function drill(row) {
    if (data.breakdown.level === 'REGION') setFilter({ regionId: row.key, institutionId: '' });
    else if (data.breakdown.level === 'INSTITUTION') setFilter({ institutionId: row.key });
  }

  const crumbs = [{ label: regional ? 'My regions' : 'National', onClick: () => setParams(filters.academicYear ? { academicYear: filters.academicYear } : {}) }];
  if (filters.regionId) crumbs.push({ label: data?.filters.regions.find((r) => r.regionId === filters.regionId)?.name || filters.regionId, onClick: () => setFilter({ institutionId: '' }) });
  if (data?.scope.institution) crumbs.push({ label: data.scope.institution.name });

  return (
    <>
      <PageHeader
        title={regional ? 'Regional dashboard' : 'National dashboard'}
        subtitle={regional ? `Assigned region(s): ${user.regionIds.join(', ')}` : 'National aggregate view. Student identifiers are never shown here.'}
        onRefresh={dashboard.reload}
        refreshing={dashboard.loading}
        actions={(
          <Button variant="outline-primary" icon="download" loading={exporter.busy} onClick={() => exporter.run(() => downloadFile(`/reports/${regional ? 'region' : 'national'}.csv${toQuery({ academicYear: filters.academicYear || data?.scope.academicYear })}`, 'report.csv'), { success: 'Report downloaded (aggregated counts only).' })}>
            Export {regional ? 'regional' : 'national'} report
          </Button>
        )}
      />
      <DataState loading={dashboard.loading} error={dashboard.error} onRetry={dashboard.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <div className="d-flex flex-wrap align-items-center gap-2 mb-2"><SyntheticTag /><span className="small text-muted">Generated {formatDate(data.generatedAt, true)}</span></div>
            <form className="row g-2 align-items-end mb-3" onSubmit={(e) => e.preventDefault()}>
              <div className="col-6 col-md-3">
                <label className="form-label" htmlFor="d-year">Academic year</label>
                <select id="d-year" className="form-select" value={filters.academicYear || data.scope.academicYear || ''} onChange={(e) => setFilter({ academicYear: e.target.value })}>
                  {data.filters.academicYears.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>
              <div className="col-6 col-md-3">
                <label className="form-label" htmlFor="d-region">Region</label>
                <select id="d-region" className="form-select" value={filters.regionId} onChange={(e) => setFilter({ regionId: e.target.value, institutionId: '' })}>
                  <option value="">{regional ? 'All my regions' : 'All regions'}</option>
                  {data.filters.regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.name}</option>)}
                </select>
              </div>
              <div className="col-6 col-md-3">
                <label className="form-label" htmlFor="d-state">State (synthetic code)</label>
                <select id="d-state" className="form-select" value={filters.stateCode} onChange={(e) => setFilter({ stateCode: e.target.value, institutionId: '' })}>
                  <option value="">All states</option>
                  {data.filters.states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-6 col-md-3">
                <Button variant="link" onClick={() => setParams({})}>Clear filters</Button>
              </div>
            </form>

            <nav aria-label="Drill-down breadcrumb" className="mb-3">
              <ol className="breadcrumb mb-0">
                {crumbs.map((crumb, index) => (
                  <li key={crumb.label} className={`breadcrumb-item ${index === crumbs.length - 1 ? 'active' : ''}`}>
                    {index < crumbs.length - 1 ? <button type="button" className="btn btn-link p-0 align-baseline" style={{ minWidth: 0, minHeight: 0 }} onClick={crumb.onClick}>{crumb.label}</button> : crumb.label}
                  </li>
                ))}
              </ol>
            </nav>

            <div className="row g-3 mb-3">
              <div className="col-6 col-lg-3"><KpiTile label="Institutions in view" value={data.kpis.institutions} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="Active enrolments" value={data.kpis.activeEnrolments} /></div>
              <div className="col-6 col-lg-3"><KpiTile label={`Seats filled of ${data.kpis.seatCapacity}`} value={`${data.kpis.seatsFilled} (${data.kpis.utilisationPct}%)`} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="Batches awaiting college review" value={data.kpis.batchesAwaitingReview} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="Open conflict cases" value={data.kpis.openConflicts} status={data.kpis.openConflicts ? 'warning' : undefined} hint={<Link to="/aicte/conflicts">Open conflict monitor</Link>} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="Overdue conflict reviews" value={data.kpis.overdueConflicts} status={data.kpis.overdueConflicts ? 'danger' : undefined} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="Open risk cases" value={data.kpis.openRiskCases} hint={<Link to="/aicte/risk">Open risk queue</Link>} /></div>
              <div className="col-6 col-lg-3"><KpiTile label="High-priority risk cases" value={data.kpis.highPriorityRiskCases} status={data.kpis.highPriorityRiskCases ? 'danger' : undefined} hint="Priority for review, not proof of wrongdoing" /></div>
            </div>

            <section className="card-gov">
              <h2>Breakdown by {data.breakdown.level.toLowerCase()}</h2>
              {data.breakdown.level !== 'COURSE' && <p className="small text-muted">Select a row to drill down one level.</p>}
              <DataTable
                caption={`Breakdown by ${data.breakdown.level.toLowerCase()}`}
                rowKey={(row) => row.key}
                columns={[
                  { key: 'label', header: data.breakdown.level.charAt(0) + data.breakdown.level.slice(1).toLowerCase(), render: (row) => (data.breakdown.level === 'COURSE' ? row.label : <Button variant="link" size="sm" onClick={() => drill(row)}>{row.label}</Button>) },
                  { key: 'usage', header: 'Seats filled / capacity', render: (row) => <SeatBar filled={row.filled} capacity={row.capacity} /> },
                  { key: 'utilisationPct', header: 'Utilisation %', numeric: true },
                  { key: 'activeEnrolments', header: 'Active enrolments', numeric: true },
                  data.breakdown.level !== 'COURSE' && { key: 'openConflicts', header: 'Open conflicts', numeric: true },
                  data.breakdown.level !== 'COURSE' && { key: 'openRiskCases', header: 'Open risk cases', numeric: true },
                ].filter(Boolean)}
                rows={data.breakdown.rows}
              />
              {data.scope.institution && (
                <p className="mt-2 mb-0"><Link to={`/aicte/institutions/${data.scope.institution.id}/seat-ledger`}>Open the full seat ledger for {data.scope.institution.name}</Link></p>
              )}
            </section>
          </>
        )}
      </DataState>
    </>
  );
}
