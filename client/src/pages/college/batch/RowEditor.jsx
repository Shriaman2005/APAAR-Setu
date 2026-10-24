import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../services/apiClient';
import { useAction, useApi } from '../../../hooks/useApi';
import Modal from '../../../components/Modal';
import { Alert, Button, DataState, ErrorAlert, StatusBadge, formatDate } from '../../../components/ui';

const LABELS = {
  studentCode: 'Student code', studentName: 'Student name', courseCode: 'Course code', academicYear: 'Academic year', bucketCode: 'Bucket code',
  externalIdDemo: 'Demo external identifier (mock)', contactToken: 'Contact token (synthetic)', yearOfStudy: 'Year of study', admittedOn: 'Admitted on (YYYY-MM-DD)',
};

/**
 * Shows one staged row with its current and previous validation results. The operator can edit the
 * permitted CSV fields; internal fields (row number, status, original upload) stay read-only.
 */
export default function RowEditor({ batchId, rowNumber, canEdit, onClose, onSaved }) {
  const detail = useApi(() => api(`/batches/${batchId}/rows/${rowNumber}`), [batchId, rowNumber]);
  const [values, setValues] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const save = useAction();

  useEffect(() => {
    if (detail.data) setValues({ ...detail.data.row.fields });
  }, [detail.data]);

  const changes = useMemo(() => {
    if (!values || !detail.data) return {};
    const out = {};
    for (const field of detail.data.editableFields) if ((values[field] ?? '') !== (detail.data.row.fields[field] ?? '')) out[field] = values[field];
    return out;
  }, [values, detail.data]);
  const dirty = Object.keys(changes).length > 0;

  function requestClose() {
    if (dirty && canEdit) setConfirmDiscard(true);
    else onClose();
  }

  async function submit() {
    const result = await save.run(() => api(`/batches/${batchId}/rows/${rowNumber}`, { method: 'PATCH', body: { changes } }), { success: `Row ${rowNumber} saved to staging. Run "Revalidate changed rows" to check it again.` });
    if (result) { onSaved(); onClose(); }
  }

  const row = detail.data?.row;
  return (
    <Modal
      title={`Row ${rowNumber}${canEdit ? ' - edit' : ''}`}
      size="lg"
      onClose={requestClose}
      busy={save.busy}
      footer={canEdit ? (
        <>
          <Button icon="save" onClick={submit} loading={save.busy} loadingText="Saving..." disabled={!dirty} disabledReason="Change at least one field first.">Save correction</Button>
          <Button variant="outline-primary" onClick={requestClose} disabled={save.busy}>Cancel edit</Button>
        </>
      ) : <Button variant="outline-primary" onClick={onClose}>Close</Button>}
    >
      <DataState loading={detail.loading} error={detail.error} onRetry={detail.reload} hasData={Boolean(row)}>
        {row && values && (
          <>
            <p className="mb-2"><StatusBadge status={row.validationStatus} /> {row.isStale && <span className="small text-muted ms-2">This row changed after the last validation; results below are from before the change.</span>}</p>
            {confirmDiscard && (
              <Alert kind="warning" className="mb-3" title="Discard unsaved changes?">
                <div className="d-flex gap-2 mt-2">
                  <Button size="sm" variant="danger" onClick={onClose}>Discard changes</Button>
                  <Button size="sm" variant="outline-primary" onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
                </div>
              </Alert>
            )}
            <div className="row g-2">
              {detail.data.editableFields.map((field) => (
                <div className="col-md-6" key={field}>
                  <label className="form-label small" htmlFor={`row-${field}`}>{LABELS[field] || field}</label>
                  <input id={`row-${field}`} className="form-control" value={values[field] ?? ''} disabled={!canEdit} maxLength={200}
                    onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))} />
                  {row.rawSafeFields[field] !== row.fields[field] && <div className="small text-muted">Originally uploaded: “{row.rawSafeFields[field] || 'empty'}”</div>}
                </div>
              ))}
            </div>
            <ErrorAlert error={save.error} />

            <h3 className="mt-4">Current validation results</h3>
            {detail.data.currentIssues.length === 0 ? <p className="text-muted">No issues on this row.</p> : (
              <ul className="list-unstyled">
                {detail.data.currentIssues.map((issue) => (
                  <li key={issue.id} className="mb-2"><StatusBadge status={issue.severity} /> <span className="mono small">{issue.ruleCode}</span><div>{issue.message}</div><div className="small text-muted">Fix: {issue.correctionHint}</div></li>
                ))}
              </ul>
            )}
            {detail.data.issueHistory.length > 0 && (
              <>
                <h3>Earlier results (kept for the audit trail)</h3>
                <ul className="list-unstyled small">
                  {detail.data.issueHistory.map((issue) => <li key={issue.id}><StatusBadge status={issue.resolutionStatus} /> {issue.ruleCode} (run {issue.validationRun}) - {issue.resolutionReason}</li>)}
                </ul>
              </>
            )}
            {row.corrections.length > 0 && (
              <>
                <h3>Correction history</h3>
                <ul className="small">{row.corrections.map((c) => <li key={`${c.field}-${c.at}`}>{formatDate(c.at, true)}: {LABELS[c.field] || c.field} “{c.from || 'empty'}” → “{c.to || 'empty'}”</li>)}</ul>
              </>
            )}
          </>
        )}
      </DataState>
    </Modal>
  );
}
