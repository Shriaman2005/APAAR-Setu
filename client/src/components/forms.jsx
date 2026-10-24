// Form fields with labels above inputs, required markers and error text below (colour_theme.md).
import { useId, useState } from 'react';
import Modal from './Modal';
import { Button, ErrorAlert, Icon } from './ui';

function FieldWrapper({ id, label, required, error, hint, children }) {
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {label}
        {required && (<><span className="required-mark" aria-hidden="true">*</span><span className="visually-hidden"> (required)</span></>)}
      </label>
      {children}
      {hint && <div className="form-text" id={`${id}-hint`}>{hint}</div>}
      {error && <div className="field-error" id={`${id}-error`}><Icon name="exclamation-circle" /> {error}</div>}
    </div>
  );
}

export function TextField({ label, value, onChange, required, error, hint, type = 'text', ...rest }) {
  const id = useId();
  return (
    <FieldWrapper id={id} label={label} required={required} error={error} hint={hint}>
      <input
        id={id}
        type={type}
        className={`form-control ${error ? 'is-invalid' : ''}`}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-required={required ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
    </FieldWrapper>
  );
}

export function TextAreaField({ label, value, onChange, required, error, hint, rows = 3, ...rest }) {
  const id = useId();
  return (
    <FieldWrapper id={id} label={label} required={required} error={error} hint={hint}>
      <textarea
        id={id}
        rows={rows}
        className={`form-control ${error ? 'is-invalid' : ''}`}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-required={required ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
    </FieldWrapper>
  );
}

export function SelectField({ label, value, onChange, options, required, error, hint, placeholder, ...rest }) {
  const id = useId();
  return (
    <FieldWrapper id={id} label={label} required={required} error={error} hint={hint}>
      <select
        id={id}
        className={`form-select ${error ? 'is-invalid' : ''}`}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-required={required ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </FieldWrapper>
  );
}

export function CheckboxField({ label, checked, onChange, hint, id: givenId, ...rest }) {
  const generated = useId();
  const id = givenId || generated;
  return (
    <div className="form-check mb-2">
      <input id={id} type="checkbox" className="form-check-input" checked={checked} onChange={(event) => onChange(event.target.checked)} {...rest} />
      <label className="form-check-label" htmlFor={id}>{label}</label>
      {hint && <div className="form-text">{hint}</div>}
    </div>
  );
}

/**
 * Confirmation dialog for high-impact actions. Calls onConfirm and stays open on failure.
 */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', variant = 'primary', onConfirm, onClose, busy, error, children, confirmDisabled }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <Button variant={variant} onClick={onConfirm} loading={busy} disabled={confirmDisabled}>{confirmLabel}</Button>
          <Button variant="outline-primary" onClick={onClose} disabled={busy}>Cancel</Button>
        </>
      )}
    >
      {message && <p>{message}</p>}
      {children}
      <ErrorAlert error={error} className="mt-3 mb-0" />
    </Modal>
  );
}

/**
 * Dialog that requires a written reason (min length) before confirming, e.g. return, revoke, disable.
 */
export function ReasonDialog({ title, description, label = 'Reason', minLength = 10, confirmLabel = 'Submit', variant = 'primary', onSubmit, onClose, busy, error, initialValue = '', children }) {
  const [text, setText] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const tooShort = text.trim().length < minLength;
  return (
    <ConfirmDialog
      title={title}
      variant={variant}
      confirmLabel={confirmLabel}
      onClose={onClose}
      busy={busy}
      error={error}
      onConfirm={() => {
        setTouched(true);
        if (!tooShort) onSubmit(text.trim());
      }}
    >
      {description && <p>{description}</p>}
      {children}
      <TextAreaField
        label={label}
        value={text}
        onChange={setText}
        required
        rows={3}
        maxLength={1000}
        hint={`At least ${minLength} characters. This is recorded in the audit history.`}
        error={touched && tooShort ? `Enter at least ${minLength} characters.` : null}
        onBlur={() => setTouched(true)}
      />
    </ConfirmDialog>
  );
}
