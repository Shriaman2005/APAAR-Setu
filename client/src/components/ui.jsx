// Small shared building blocks used across pages.
import { Link } from 'react-router-dom';

export function Icon({ name, className = '' }) {
  return <i className={`bi bi-${name} ${className}`} aria-hidden="true" />;
}

/**
 * Button with a built-in loading state (spinner + aria-busy, clicks disabled while busy).
 * `disabledReason` is shown as text so users always see WHY an action is unavailable.
 */
export function Button({ variant = 'primary', icon, loading = false, loadingText, disabled, disabledReason, children, className = '', size, ...rest }) {
  const isDisabled = disabled || loading;
  return (
    <>
      <button
        type="button"
        className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
        disabled={isDisabled}
        aria-busy={loading ? 'true' : undefined}
        aria-disabled={isDisabled ? 'true' : undefined}
        title={disabled && disabledReason ? disabledReason : undefined}
        {...rest}
      >
        {loading ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : icon && <Icon name={icon} />}
        {loading ? loadingText || 'Working...' : children}
      </button>
      {disabled && disabledReason && !loading && <span className="visually-hidden">{disabledReason}</span>}
    </>
  );
}

export function Alert({ kind = 'info', title, children, className = '' }) {
  const icons = { info: 'info-circle', success: 'check-circle', warning: 'exclamation-triangle', error: 'exclamation-octagon' };
  return (
    <div className={`alert-gov ${kind} ${className}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon name={icons[kind]} />
      <div className="flex-grow-1">
        {title && <strong className="d-block">{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function ErrorAlert({ error, onRetry, className = 'my-3' }) {
  if (!error) return null;
  const fieldErrors = error.details?.fieldErrors;
  const blockers = error.details?.blockers;
  return (
    <Alert kind="error" title="Something went wrong" className={className}>
      <div>{error.message}</div>
      {blockers && (
        <ul className="mb-0 mt-1">{blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
      )}
      {fieldErrors && (
        <ul className="mb-0 mt-1">{Object.entries(fieldErrors).map(([field, messages]) => <li key={field}><strong>{field}</strong>: {[].concat(messages).join(' ')}</li>)}</ul>
      )}
      {error.details?.problems && (
        <ul className="mb-0 mt-1">{error.details.problems.map((p) => <li key={p.issueId}>{p.problem}</li>)}</ul>
      )}
      {error.code && error.code !== 'NETWORK_ERROR' && <div className="small mt-1">Code: <span className="mono">{error.code}</span></div>}
      {onRetry && <Button variant="outline-primary" size="sm" className="mt-2" icon="arrow-clockwise" onClick={onRetry}>Try again</Button>}
    </Alert>
  );
}

export function LoadingBlock({ text = 'Loading...' }) {
  return (
    <div className="d-flex align-items-center gap-2 py-4 text-muted" role="status" aria-live="polite">
      <span className="spinner-border spinner-border-sm" aria-hidden="true" /> {text}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title = 'Nothing to show yet', children }) {
  return (
    <div className="text-center py-5 text-muted">
      <Icon name={icon} className="fs-1 d-block mb-2" />
      <p className="fw-semibold mb-1">{title}</p>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

/**
 * Renders loading / error / empty / content in a consistent way.
 */
export function DataState({ loading, error, onRetry, empty, emptyTitle, emptyText, children, hasData }) {
  if (error) return <ErrorAlert error={error} onRetry={onRetry} />;
  if (loading && !hasData) return <LoadingBlock />;
  if (empty) return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>;
  return children;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions, onRefresh, refreshing }) {
  return (
    <div className="mb-3">
      {breadcrumbs && (
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumb small mb-1">
            {breadcrumbs.map((crumb, index) => (
              <li key={crumb.label} className={`breadcrumb-item ${index === breadcrumbs.length - 1 ? 'active' : ''}`} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>
                {crumb.to && index !== breadcrumbs.length - 1 ? <Link to={crumb.to}>{crumb.label}</Link> : crumb.label}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2">
        <div>
          <h1 className="mb-1">{title}</h1>
          {subtitle && <p className="text-muted mb-0">{subtitle}</p>}
        </div>
        <div className="d-flex flex-wrap gap-2">
          {actions}
          {onRefresh && (
            <Button variant="outline-primary" icon="arrow-clockwise" onClick={onRefresh} loading={refreshing} loadingText="Refreshing...">Refresh</Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function KpiTile({ label, value, status, hint }) {
  return (
    <div className={`kpi-tile ${status ? `kpi-${status}` : ''}`}>
      <div className="kpi-value">{value ?? '-'}</div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="small text-muted mt-1">{hint}</div>}
    </div>
  );
}

const BADGES = {
  // Batch statuses
  UPLOADED: ['pending', 'cloud-upload', 'Uploaded'],
  VALIDATING: ['pending', 'hourglass-split', 'Validating'],
  NEEDS_CORRECTION: ['error', 'pencil-square', 'Needs correction'],
  VALIDATED: ['info', 'check2-square', 'Validated'],
  READY_FOR_REVIEW: ['warning', 'person-check', 'Ready for review'],
  RETURNED_FOR_CORRECTION: ['error', 'arrow-return-left', 'Returned for correction'],
  COMMITTING: ['pending', 'hourglass-split', 'Committing'],
  COMMITTED: ['success', 'patch-check', 'Committed'],
  COMMIT_FAILED: ['error', 'x-octagon', 'Commit failed'],
  DISCARDED: ['pending', 'trash', 'Discarded'],
  // Severities
  ERROR: ['error', 'x-circle', 'Error'],
  WARNING: ['warning', 'exclamation-triangle', 'Warning'],
  PENDING: ['pending', 'hourglass', 'Pending'],
  INFO: ['info', 'info-circle', 'Info'],
  RISK_FLAG: ['risk', 'flag', 'Risk signal'],
  // Issue resolution
  OPEN: ['warning', 'circle', 'Open'],
  JUSTIFIED: ['info', 'chat-left-text', 'Justified'],
  ACCEPTED: ['success', 'check2-circle', 'Accepted'],
  RESOLVED: ['success', 'check-circle', 'Resolved'],
  SUPERSEDED: ['pending', 'clock-history', 'Superseded'],
  // Row statuses
  VALID: ['success', 'check-circle', 'Valid'],
  HAS_ERRORS: ['error', 'x-circle', 'Has errors'],
  HAS_WARNINGS: ['warning', 'exclamation-triangle', 'Has warnings'],
  STALE: ['pending', 'arrow-repeat', 'Changed - revalidate'],
  EXCLUDED: ['pending', 'slash-circle', 'Excluded'],
  NOT_VALIDATED: ['pending', 'dash-circle', 'Not validated'],
  // Enrolment states
  PROVISIONAL: ['warning', 'hourglass', 'Provisional'],
  CONFIRMED: ['success', 'patch-check', 'Confirmed'],
  WITHDRAWN: ['pending', 'box-arrow-left', 'Withdrawn'],
  TRANSFERRED: ['info', 'arrow-left-right', 'Transferred'],
  COMPLETED: ['success', 'mortarboard', 'Completed'],
  DROPPED: ['pending', 'x-circle', 'Dropped'],
  // Conflict / risk / consent / credential / users
  AWAITING_REVIEW: ['warning', 'hourglass-split', 'Awaiting review'],
  ASSIGNED: ['info', 'person-badge', 'Assigned'],
  REVIEWED: ['success', 'check2-circle', 'Reviewed'],
  FALSE_POSITIVE: ['pending', 'hand-thumbs-down', 'False positive'],
  ESCALATED: ['error', 'arrow-up-circle', 'Escalated'],
  APPROVED: ['success', 'check-circle', 'Approved'],
  DENIED: ['error', 'x-circle', 'Denied'],
  REVOKED: ['error', 'slash-circle', 'Revoked'],
  EXPIRED: ['pending', 'clock', 'Expired'],
  CANCELLED: ['pending', 'x', 'Cancelled'],
  ACTIVE: ['success', 'check-circle', 'Active'],
  VALID_CREDENTIAL: ['success', 'shield-check', 'Valid'],
  INVALID_OR_TAMPERED: ['error', 'shield-exclamation', 'Invalid or tampered'],
  DISABLED: ['error', 'slash-circle', 'Disabled'],
  PENDING_ACTIVATION: ['pending', 'envelope', 'Pending activation'],
  DRAFT: ['pending', 'pencil', 'Draft'],
  PENDING_APPROVAL: ['warning', 'hourglass-split', 'Pending approval'],
  PUBLISHED: ['success', 'broadcast', 'Published'],
  REJECTED: ['error', 'x-circle', 'Rejected'],
  SUBMITTED: ['warning', 'send', 'Submitted'],
  MATCHED: ['success', 'person-check', 'Matched (mock)'],
  NAME_MISMATCH: ['warning', 'person-exclamation', 'Name mismatch (mock)'],
  NOT_FOUND: ['warning', 'question-circle', 'Not found (mock)'],
  NOT_CHECKED: ['pending', 'dash-circle', 'Not checked'],
  FORMAT_INVALID: ['error', 'x-circle', 'Format invalid'],
  HIGH: ['error', 'arrow-up', 'High priority'],
  MEDIUM: ['warning', 'dash', 'Medium priority'],
  LOW: ['info', 'arrow-down', 'Low priority'],
  PASS: ['success', 'shield-check', 'Pass'],
  FAIL: ['error', 'shield-exclamation', 'Fail'],
};

export function StatusBadge({ status, label }) {
  const [kind, icon, text] = BADGES[status] || ['pending', 'circle', status || 'Unknown'];
  return (
    <span className={`status-badge status-${kind}`}>
      <Icon name={icon} />
      {label || text}
    </span>
  );
}

export function RoleChip({ role }) {
  const group = role?.startsWith('COLLEGE') ? 'institution' : role?.startsWith('AICTE') ? 'aicte' : role === 'STUDENT' ? 'student' : 'verifier';
  return <span className={`role-chip role-${group}`}>{role?.replaceAll('_', ' ').toLowerCase()}</span>;
}

/**
 * Simple accessible table. columns: [{ key, header, render?, numeric? }]
 */
export function DataTable({ columns, rows, rowKey, caption, onRowClick }) {
  return (
    <div className="table-responsive" style={{ maxHeight: '70vh' }}>
      <table className="table table-gov align-middle">
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col" className={column.numeric ? 'num' : ''}>{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row) : index} onClick={onRowClick ? () => onRowClick(row) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'num' : ''}>{column.render ? column.render(row) : row[column.key] ?? '-'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPage }) {
  if (!totalPages || totalPages <= 1) return total !== undefined ? <p className="small text-muted mt-2 mb-0">{total} record(s)</p> : null;
  return (
    <nav className="d-flex flex-wrap align-items-center gap-2 mt-2" aria-label="Pagination">
      <Button variant="outline-primary" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="small">Page {page} of {totalPages} ({total} records)</span>
      <Button variant="outline-primary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next <Icon name="chevron-right" className="ms-1" /></Button>
    </nav>
  );
}

export function SeatBar({ filled, capacity }) {
  const percent = capacity > 0 ? Math.min(100, Math.round((filled / capacity) * 100)) : 0;
  return (
    <div className="d-flex align-items-center gap-2">
      <div className={`seat-bar flex-grow-1 ${filled >= capacity ? 'full' : ''}`} role="img" aria-label={`${filled} of ${capacity} seats filled`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="small text-nowrap">{filled}/{capacity}</span>
    </div>
  );
}

export function Stepper({ steps, current }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : '';
        return (
          <li key={step} className={state} aria-current={index === current ? 'step' : undefined}>
            <span className="step-dot">{index < current ? <Icon name="check-lg" /> : index + 1}</span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}

export function KeyValue({ items }) {
  return (
    <dl className="kv">
      {items.filter(Boolean).map(([label, value]) => (
        <div key={label} className="contents" style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function formatDate(value, withTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return withTime
    ? date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function SyntheticTag() {
  return <span className="status-badge status-warning"><Icon name="cone-striped" />Synthetic demo data</span>;
}
