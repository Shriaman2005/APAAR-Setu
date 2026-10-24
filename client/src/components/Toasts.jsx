import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Small notification messages (success / error) announced to screen readers.
const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const push = useCallback((kind, message) => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-3), { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 5000);
  }, [dismiss]);

  const value = useMemo(() => ({
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    info: (message) => push('info', message),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`alert-gov ${toast.kind === 'error' ? 'error' : toast.kind === 'success' ? 'success' : 'info'} shadow-sm`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            <i className={`bi ${toast.kind === 'error' ? 'bi-exclamation-octagon' : toast.kind === 'success' ? 'bi-check-circle' : 'bi-info-circle'}`} aria-hidden="true" />
            <div className="flex-grow-1">{toast.message}</div>
            <button type="button" className="btn-close" aria-label="Dismiss message" onClick={() => dismiss(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
