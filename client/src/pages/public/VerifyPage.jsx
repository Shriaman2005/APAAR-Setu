import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { api } from '../../services/apiClient';
import { useDocumentTitle } from '../../hooks/useApi';
import { Alert, Button, ErrorAlert, Icon, KeyValue, StatusBadge, formatDate } from '../../components/ui';
import { TextField } from '../../components/forms';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const REF_IN_TEXT = /CRD-[0-9a-f]{32}-[0-9a-f]{12}/i;

// Pulls the credential reference out of a scanned QR payload (a URL) or typed text.
export function extractReference(text) {
  const match = REF_IN_TEXT.exec(String(text || ''));
  return match ? match[0] : String(text || '').trim();
}

function decodeFromCanvas(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(image.data, image.width, image.height);
  return code ? code.data : null;
}

/**
 * Public QR verification. Decoding happens in the browser: uploaded images and camera frames are
 * never sent to or stored on the server - only the extracted reference is checked.
 */
export default function VerifyPage() {
  useDocumentTitle('Verify a credential');
  const params = useParams();
  const navigate = useNavigate();
  const [reference, setReference] = useState(params.credentialRef || '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  const verify = useCallback(async (value) => {
    const ref = extractReference(value);
    if (!ref) {
      setError({ message: 'Enter or scan a credential reference first.' });
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api(`/verify/${encodeURIComponent(ref)}`));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (params.credentialRef) verify(params.credentialRef);
  }, [params.credentialRef, verify]);

  const stopCamera = useCallback(() => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setScanMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanMessage('This browser cannot use the camera. Upload a QR image or type the reference instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      requestAnimationFrame(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        const canvas = document.createElement('canvas');
        timerRef.current = setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext('2d').drawImage(video, 0, 0);
          const text = decodeFromCanvas(canvas);
          if (text) {
            stopCamera();
            const ref = extractReference(text);
            setReference(ref);
            verify(ref);
          }
        }, 300);
      });
    } catch {
      setScanMessage('Camera permission was denied or no camera is available. Upload a QR image or type the reference instead.');
      stopCamera();
    }
  }

  function handleImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setScanMessage(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setScanMessage('Choose a PNG, JPEG or WebP image of the QR code.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setScanMessage('The image is larger than 2 MB. Crop it to the QR code and try again.');
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      const text = decodeFromCanvas(canvas);
      if (!text) {
        setScanMessage('No QR code could be read from that image.');
        return;
      }
      const ref = extractReference(text);
      setReference(ref);
      verify(ref);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setScanMessage('That file could not be read as an image.');
    };
    image.src = url;
  }

  function clearAll() {
    stopCamera();
    setReference('');
    setResult(null);
    setError(null);
    setScanMessage(null);
    if (params.credentialRef) navigate('/verify', { replace: true });
  }

  const statusKey = result?.status === 'VALID' ? 'VALID_CREDENTIAL' : result?.status;
  return (
    <>
      <h1>Verify a credential</h1>
      <p className="text-muted">Check the current status of a prototype credential from its QR code or reference. No sign-in is needed and no personal data is shown.</p>
      <div className="row g-3">
        <div className="col-lg-6">
          <section className="card-gov">
            <h2>1. Provide the reference</h2>
            <div className="d-flex flex-wrap gap-2 mb-3">
              {!scanning ? (
                <Button variant="outline-primary" icon="camera" onClick={startCamera}>Scan QR with camera</Button>
              ) : (
                <Button variant="outline-danger" icon="stop-circle" onClick={stopCamera}>Stop camera</Button>
              )}
              <label className="btn btn-outline-primary mb-0">
                <Icon name="image" />Upload QR image
                <input type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" onChange={handleImage} />
              </label>
            </div>
            {scanning && <video ref={videoRef} className="w-100 border rounded mb-3" muted playsInline aria-label="Camera preview for QR scanning" />}
            {scanMessage && <Alert kind="warning" className="mb-3">{scanMessage}</Alert>}
            <form onSubmit={(event) => { event.preventDefault(); verify(reference); }}>
              <TextField label="Credential reference or verification link" value={reference} onChange={setReference} placeholder="CRD-..." hint="The reference printed under the QR code, or the full verification link." />
              <div className="d-flex gap-2">
                <Button type="submit" icon="shield-check" loading={busy} loadingText="Checking...">Verify</Button>
                <Button variant="outline-primary" icon="x-lg" onClick={clearAll}>Clear</Button>
              </div>
            </form>
          </section>
        </div>
        <div className="col-lg-6">
          <section className="card-gov" aria-live="polite">
            <h2>2. Result</h2>
            <ErrorAlert error={error} />
            {!result && !error && <p className="text-muted mb-0">The status will appear here.</p>}
            {result && (
              <>
                <p className="fs-5"><StatusBadge status={statusKey} /></p>
                {result.status === 'VALID' && <Alert kind="success">The credential reference exists and is currently <strong>active</strong> in the prototype register.</Alert>}
                {result.status === 'REVOKED' && <Alert kind="error">This credential was <strong>revoked</strong> by its issuer. Do not rely on it.</Alert>}
                {result.status === 'INVALID_OR_TAMPERED' && <Alert kind="error">The reference is not recognised. It may be mistyped, altered or invented.</Alert>}
                {result.credentialType && (
                  <div className="mt-3">
                    <KeyValue items={[
                      ['Credential type', result.credentialTypeLabel],
                      ['Issuer', result.issuerName],
                      ['Issued on', formatDate(result.issuedOn)],
                      result.revokedOn && ['Revoked on', formatDate(result.revokedOn)],
                      ['Reference ends with', <span className="mono" key="fp">{result.referenceFingerprint}</span>],
                      ['Checked at', formatDate(result.checkedAt, true)],
                      ['Verification mode', result.verificationMode],
                    ]} />
                  </div>
                )}
                <Alert kind="warning" className="mt-3">{result.disclaimer}</Alert>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
