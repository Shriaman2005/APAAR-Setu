import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fetchImageUrl } from '../../services/apiClient';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { Alert, Button, DataState, KeyValue, StatusBadge, formatDate } from '../../components/ui';

export function useQrImage(credentialRef) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let objectUrl = null;
    let active = true;
    setUrl(null);
    fetchImageUrl(`/credentials/${credentialRef}/qr.png`)
      .then((value) => { objectUrl = value; if (active) setUrl(value); })
      .catch((err) => { if (active) setError(err); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [credentialRef]);
  return { url, error };
}

/**
 * Shows one prototype credential with its QR code, current status and honest limitations.
 */
export function CredentialPanel({ credential, actions }) {
  const qr = useQrImage(credential.credentialRef);
  return (
    <div className="row g-3 align-items-start">
      <div className="col-md-4 text-center">
        {qr.url ? <img src={qr.url} alt={`QR code linking to the status page for credential ending ${credential.credentialRef.slice(-6)}`} className="img-fluid border rounded" style={{ maxWidth: 220 }} /> : qr.error ? <p className="text-danger small">QR unavailable: {qr.error.message}</p> : <p className="small text-muted">Loading QR...</p>}
        {qr.url && <a className="btn btn-outline-primary btn-sm mt-2" href={qr.url} download={`credential-${credential.credentialRef.slice(-6)}-DEMO.png`}><i className="bi bi-download" aria-hidden="true" />Download QR</a>}
      </div>
      <div className="col-md-8">
        <KeyValue items={[
          ['Status', <StatusBadge key="s" status={credential.status} />],
          ['Type', credential.credentialTypeLabel],
          ['Holder', credential.snapshot?.displayName],
          ['Programme', `${credential.snapshot?.programName || ''} (${credential.snapshot?.academicYear || ''})`],
          ['Issued', formatDate(credential.issuedAt, true)],
          credential.revokedAt && ['Revoked', `${formatDate(credential.revokedAt, true)} - ${credential.revocationReason}`],
          ['Reference', <span key="r" className="mono">{credential.credentialRef}</span>],
          ['Verification mode', credential.verificationMode],
          credential.mockDigiLockerPush && ['DigiLocker', `${credential.mockDigiLockerPush.status} (mock adapter - nothing was sent)`],
        ]} />
        <Alert kind="warning" className="mt-3">Prototype credential: the QR links to a status page. It is not a cryptographically signed credential and does not prove identity offline.</Alert>
        <div className="d-flex flex-wrap gap-2 mt-2">
          <Link className="btn btn-outline-primary btn-sm" to={`/credentials/${credential.credentialRef}/print`}><i className="bi bi-printer" aria-hidden="true" />Open printable certificate</Link>
          <Link className="btn btn-outline-primary btn-sm" to={`/verify/${credential.credentialRef}`}><i className="bi bi-shield-check" aria-hidden="true" />Check public status</Link>
          {actions}
        </div>
      </div>
    </div>
  );
}

// Printable demo certificate with a visible DEMO watermark.
export function CertificatePrintPage() {
  const { credentialRef } = useParams();
  useDocumentTitle('Demo certificate');
  const credential = useApi(() => api(`/credentials/${credentialRef}`), [credentialRef]);
  const qr = useQrImage(credentialRef);
  const c = credential.data;
  return (
    <DataState loading={credential.loading} error={credential.error} onRetry={credential.reload} hasData={Boolean(c)}>
      {c && (
        <>
          <div className="no-print d-flex gap-2 mb-3">
            <Button icon="printer" onClick={() => window.print()}>Print / save as PDF</Button>
            <Button variant="outline-primary" onClick={() => window.history.back()}>Back</Button>
          </div>
          <div className="certificate mx-auto" style={{ maxWidth: 760 }}>
            <div className="watermark" aria-hidden="true">DEMO - NOT VALID</div>
            <p className="text-center text-uppercase small fw-bold text-danger mb-1">Prototype demonstration certificate - synthetic data - not an official document</p>
            <h1 className="text-center h2">{c.credentialTypeLabel}</h1>
            <p className="text-center">issued by <strong>{c.issuerName}</strong></p>
            <p className="text-center fs-5 mt-4">This is to record that</p>
            <p className="text-center fs-3 fw-bold">{c.snapshot.displayName}</p>
            <p className="text-center">is recorded as <strong>{c.snapshot.enrolmentState?.toLowerCase()}</strong> in <strong>{c.snapshot.programName}</strong> ({c.snapshot.courseCode}) at <strong>{c.snapshot.institutionName}</strong> for the academic year <strong>{c.snapshot.academicYear}</strong>.</p>
            <div className="d-flex justify-content-between align-items-end mt-4 flex-wrap gap-3">
              <div className="small">
                <div>Issued: {formatDate(c.issuedAt)}</div>
                <div>Reference: <span className="mono">{c.credentialRef}</span></div>
                <div>Status when printed: <strong>{c.status}</strong></div>
                <div className="mt-2" style={{ maxWidth: 380 }}>Scan the QR or open {c.verifyUrl} to see the CURRENT status. A printed copy does not prove current validity.</div>
              </div>
              {qr.url && <img src={qr.url} alt="QR code for the status page" style={{ width: 150 }} />}
            </div>
          </div>
        </>
      )}
    </DataState>
  );
}
