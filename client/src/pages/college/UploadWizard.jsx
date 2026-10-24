import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, downloadFile } from '../../services/apiClient';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { SelectField } from '../../components/forms';
import { Alert, Button, DataState, ErrorAlert, Icon, PageHeader, Stepper, StatusBadge } from '../../components/ui';

const STEPS = ['Template', 'Choose file', 'Pre-check', 'Submit'];

/**
 * Client-side pre-check. It only catches obvious problems early; the server validates everything
 * again and its result is the one that counts.
 */
export function precheckCsv(text, { fileName, sizeBytes, maxUploadMb, maxRows, columns }) {
  const problems = [];
  const notes = [];
  if (!/\.csv$/i.test(fileName)) problems.push('The file name must end with .csv.');
  if (sizeBytes > maxUploadMb * 1024 * 1024) problems.push(`The file is larger than ${maxUploadMb} MB.`);
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    problems.push('The file is empty.');
    return { problems, notes, rowCount: 0 };
  }
  const header = lines[0].split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
  const known = columns.map((column) => column.name);
  const missing = columns.filter((column) => column.required && !header.includes(column.name)).map((column) => column.name);
  const unexpected = header.filter((name) => !known.includes(name));
  if (missing.length) problems.push(`Missing required column(s): ${missing.join(', ')}.`);
  if (unexpected.length) problems.push(`Unexpected column(s): ${unexpected.join(', ')}. Use the current template.`);
  const rowCount = lines.length - 1;
  if (rowCount === 0) problems.push('The file has a header but no student rows.');
  if (rowCount > maxRows) problems.push(`The file has ${rowCount} rows; the limit is ${maxRows}.`);
  if (problems.length === 0) notes.push(`${rowCount} student row(s) found. Row numbers will match your spreadsheet (first student = row 2).`);
  return { problems, notes, rowCount };
}

function newKey() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function UploadWizard() {
  useDocumentTitle('Upload admission batch');
  const navigate = useNavigate();
  const info = useApi(() => api('/batches/template-info'), []);
  const [academicYear, setAcademicYear] = useState('');
  const [file, setFile] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [precheck, setPrecheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const years = info.data?.academicYears || [];
  const selectedYear = academicYear || years[0]?.academicYear || '';
  const yearInfo = useMemo(() => years.find((y) => y.academicYear === selectedYear), [years, selectedYear]);
  const step = result ? 3 : precheck ? (precheck.problems.length ? 2 : 3) : file ? 2 : 1;

  function chooseFile(event) {
    const chosen = event.target.files?.[0] || null;
    event.target.value = '';
    setFile(chosen);
    setPrecheck(null);
    setSubmitError(null);
    setIdempotencyKey(chosen ? newKey() : null); // retries of this submission reuse the same key
  }

  async function runPrecheck() {
    if (!file || !info.data) return;
    setChecking(true);
    try {
      const text = await file.slice(0, 6 * 1024 * 1024).text();
      setPrecheck(precheckCsv(text, { fileName: file.name, sizeBytes: file.size, maxUploadMb: info.data.limits.maxUploadMb, maxRows: info.data.limits.maxRows, columns: info.data.columns }));
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    if (!file || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const form = new FormData();
    form.append('academicYear', selectedYear);
    form.append('file', file);
    try {
      setResult(await api('/batches', { method: 'POST', formData: form, headers: { 'Idempotency-Key': idempotencyKey } }));
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  function downloadNote() {
    const data = info.data;
    const lines = [
      `APAAR Setu admission CSV template - ${data.templateVersion}`,
      data.notice,
      '',
      `Institution: ${data.institution.name} (${data.institution.code})`,
      data.rowNumbering,
      `Limits: ${data.limits.maxUploadMb} MB, ${data.limits.maxRows} rows per batch.`,
      '',
      'Columns:',
      ...data.columns.map((c) => ` - ${c.name}${c.required ? ' (required)' : ' (optional)'}: ${c.description}`),
      '',
      ...years.flatMap((y) => [
        `Academic year ${y.academicYear} - seat policy ${y.policyVersion} (${y.sourceType}), admission window ${y.admissionWindow.opensOn} to ${y.admissionWindow.closesOn}`,
        ...y.courses.map((c) => `   ${c.courseCode} ${c.programName}: buckets ${c.buckets.join(', ')}; duration ${c.durationYears} years`),
      ]),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `apaar-setu-template-note-${data.templateVersion}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <PageHeader title="Upload admission batch" breadcrumbs={[{ label: 'Dashboard', to: '/college' }, { label: 'Upload batch' }]} />
      <Stepper steps={STEPS} current={step} />
      <DataState loading={info.loading} error={info.error} onRetry={info.reload} hasData={Boolean(info.data)}>
        {info.data && (
          <div className="row g-3">
            <div className="col-lg-7">
              <section className="card-gov">
                <h2>1. Download the current template</h2>
                <p>{info.data.notice}</p>
                <div className="d-flex flex-wrap gap-2">
                  <Button variant="outline-primary" icon="filetype-csv" onClick={async () => { setDownloadError(null); try { await downloadFile('/batches/template.csv', 'template.csv'); } catch (e) { setDownloadError(e); } }}>Download template</Button>
                  <Button variant="outline-primary" icon="file-text" onClick={downloadNote}>Download version note</Button>
                </div>
                <ErrorAlert error={downloadError} />
              </section>

              <section className="card-gov">
                <h2>2. Choose the file</h2>
                <SelectField label="Academic year of this batch" value={selectedYear} onChange={setAcademicYear} required
                  options={years.map((y) => ({ value: y.academicYear, label: `${y.academicYear} (policy ${y.policyVersion})` }))} />
                {!file ? (
                  <label className="btn btn-primary mb-0">
                    <Icon name="folder2-open" />Choose CSV file
                    <input type="file" accept=".csv,text/csv" className="visually-hidden" onChange={chooseFile} />
                  </label>
                ) : (
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <span><Icon name="file-earmark-spreadsheet" className="me-1" /><strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)</span>
                    {!result && <Button variant="link" icon="x-circle" onClick={() => { setFile(null); setPrecheck(null); setSubmitError(null); }}>Remove file</Button>}
                  </div>
                )}
              </section>

              <section className="card-gov">
                <h2>3. Pre-check</h2>
                <p className="small text-muted">A quick check in your browser. The server validates every row again; only the server result counts.</p>
                <Button variant="outline-primary" icon="clipboard-check" onClick={runPrecheck} loading={checking} disabled={!file || Boolean(result)} disabledReason="Choose a file first.">Run pre-check</Button>
                {precheck && (
                  <div className="mt-3">
                    {precheck.problems.length > 0
                      ? <Alert kind="error" title="Fix these before uploading"><ul className="mb-0">{precheck.problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>
                      : <Alert kind="success" title="Pre-check passed">{precheck.notes.join(' ')}</Alert>}
                  </div>
                )}
              </section>

              <section className="card-gov">
                <h2>4. Submit upload</h2>
                {result ? (
                  <Alert kind="success" title="Batch received">
                    <div>Batch <strong className="mono">{result.batchId}</strong> - <StatusBadge status={result.status} /> - {result.receivedRows} row(s) received{result.idempotentReplay ? ' (this was a repeat of an earlier submission)' : ''}.</div>
                    <div className="mt-2 d-flex gap-2 flex-wrap">
                      <Button icon="eye" onClick={() => navigate(`/college/batches/${result.batchId}`)}>View batch and validation results</Button>
                      <Button variant="outline-primary" icon="plus-lg" onClick={() => { setFile(null); setPrecheck(null); setResult(null); }}>Upload another file</Button>
                    </div>
                  </Alert>
                ) : (
                  <>
                    <p className="small text-muted">Uploaded rows are staging data. Nothing is added to the official register until the college head certifies the batch.</p>
                    <Button icon="cloud-upload" onClick={submit} loading={submitting} loadingText="Uploading..." disabled={!file || !precheck || precheck.problems.length > 0} disabledReason="Choose a file and pass the pre-check first.">Submit upload</Button>
                    <ErrorAlert error={submitError} />
                    {submitError?.details?.existingBatchId && <p className="mt-2"><Link to={`/college/batches/${submitError.details.existingBatchId}`}>Open the existing batch {submitError.details.existingBatchId}</Link></p>}
                  </>
                )}
              </section>
            </div>
            <div className="col-lg-5">
              <section className="card-gov">
                <h2>Template note ({info.data.templateVersion})</h2>
                <p className="small">{info.data.rowNumbering}</p>
                <ul className="small">
                  {info.data.columns.map((column) => <li key={column.name}><strong>{column.name}</strong>{column.required ? ' (required)' : ' (optional)'} - {column.description}</li>)}
                </ul>
                {yearInfo && (
                  <>
                    <h3>Permitted values for {yearInfo.academicYear}</h3>
                    <p className="small mb-1">Seat policy {yearInfo.policyVersion} ({yearInfo.sourceType}). Admission window {yearInfo.admissionWindow.opensOn} to {yearInfo.admissionWindow.closesOn}.</p>
                    <ul className="small mb-0">
                      {yearInfo.courses.map((course) => <li key={course.courseCode}><strong>{course.courseCode}</strong> - {course.programName}: {course.buckets.join(', ')}</li>)}
                    </ul>
                  </>
                )}
                <p className="small text-muted mt-2 mb-0">Limits: {info.data.limits.maxUploadMb} MB and {info.data.limits.maxRows} rows per file.</p>
              </section>
            </div>
          </div>
        )}
      </DataState>
    </>
  );
}
