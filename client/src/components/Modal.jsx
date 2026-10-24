import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Accessible modal dialog: Escape closes it, focus moves inside on open and returns afterwards.
 */
export default function Modal({ title, onClose, children, footer, size, busy = false }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  // The latest callbacks are kept in refs so the effect below runs only once (on open).
  // Re-running it on every render would move focus back to the first field after each keystroke.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const focusable = dialogRef.current?.querySelector('input, textarea, select, button:not(.btn-close)');
    (focusable || dialogRef.current)?.focus();
    function onKey(event) {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current();
      if (event.key === 'Tab' && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])')];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop-gov" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyRef.current) onCloseRef.current(); }}>
      <div className={`modal-gov ${size === 'lg' ? 'modal-lg' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
        <div className="modal-head">
          <h2 className="h3 m-0" id={titleId}>{title}</h2>
          <button type="button" className="btn-close" aria-label="Close dialog" onClick={onClose} disabled={busy} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
