import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toasts';

/**
 * Loads data from the API and exposes loading/error state plus a reload function.
 * `deps` works like useEffect dependencies: when they change, the data is fetched again.
 */
export function useApi(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const id = latest.current + 1;
    latest.current = id;
    setLoading(true);
    setError(null);
    try {
      const result = await loader();
      if (latest.current === id) setData(result);
    } catch (err) {
      if (latest.current === id) setError(err);
    } finally {
      if (latest.current === id) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/**
 * Runs a state-changing action once at a time (prevents double submit) and reports the outcome.
 * The caller should refresh server data afterwards instead of guessing the new state.
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const running = useRef(false);

  const run = useCallback(async (action, { success, onError } = {}) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (err) {
      setError(err);
      if (onError) onError(err);
      else toast.error(err.message || 'The action failed.');
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [toast]);

  return { run, busy, error, setError };
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | APAAR Setu (Prototype)` : 'APAAR Setu (Prototype)';
  }, [title]);
}
