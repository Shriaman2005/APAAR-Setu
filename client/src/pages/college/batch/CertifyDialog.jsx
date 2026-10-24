import { useState } from 'react';
import { CheckboxField, ConfirmDialog, TextField } from '../../../components/forms';
import { Alert } from '../../../components/ui';

/**
 * Certification by the college head: declaration + typed confirmation of the batch ID.
 * OTP/e-sign is NOT implemented, so no fake OTP control is shown (spec 04 section 4).
 */
export default function CertifyDialog({ batchId, declaration, confirmationNote, onConfirm, onClose, busy, error }) {
  const [accepted, setAccepted] = useState(false);
  const [typed, setTyped] = useState('');
  const ready = accepted && typed === batchId;
  return (
    <ConfirmDialog
      title="Certify and submit batch"
      confirmLabel="Certify and submit"
      variant="success"
      onConfirm={() => ready && onConfirm()}
      confirmDisabled={!ready}
      onClose={onClose}
      busy={busy}
      error={error}
    >
      <Alert kind="info" className="mb-3">Certifying commits every included row to the prototype register in one transaction. If anything changed since validation (seat capacity, seat policy, blockers), nothing is committed and you will see why.</Alert>
      <div className="border rounded p-3 mb-3 bg-light">
        <div className="small text-muted mb-1">Declaration {declaration?.version}</div>
        <p className="mb-0">{declaration?.text}</p>
      </div>
      <CheckboxField label="I confirm the declaration above." checked={accepted} onChange={setAccepted} />
      <TextField label={`Type the batch ID (${batchId}) to confirm`} value={typed} onChange={setTyped} required autoComplete="off"
        error={typed && typed !== batchId ? 'The batch ID does not match.' : null} />
      <p className="small text-muted mb-0">{confirmationNote}</p>
    </ConfirmDialog>
  );
}
