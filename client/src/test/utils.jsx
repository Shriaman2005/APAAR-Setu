// Test helpers: a tiny fetch mock and a render helper with all app providers.
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { Providers } from '../app/App';
import ProtectedRoute from '../app/ProtectedRoute';
import { setCsrfToken } from '../services/apiClient';

/**
 * routes: { 'GET /auth/me': body | ({ body, path }) => body | { __status, body } }
 * A trailing * in the path matches any suffix (query strings, ids).
 */
export function mockFetch(routes) {
  const calls = [];
  const fetchMock = vi.fn(async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
    const method = (options.method || 'GET').toUpperCase();
    const path = `${url.pathname.replace(/^\/api/, '')}${url.search}`;
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined;
    calls.push({ method, path, body, headers: options.headers || {} });
    for (const [key, handler] of Object.entries(routes)) {
      const [routeMethod, routePath] = key.split(' ');
      const matches = routeMethod === method && (routePath.endsWith('*') ? path.startsWith(routePath.slice(0, -1)) : path === routePath);
      if (!matches) continue;
      const result = typeof handler === 'function' ? handler({ body, path }) : handler;
      const status = result && result.__status ? result.__status : 200;
      const payload = result && result.__status ? result.body : result;
      return new Response(JSON.stringify(payload ?? {}), { status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_MOCKED', message: `No mock for ${method} ${path}` } }), { status: 404, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  setCsrfToken('test-csrf-token');
  return { fetchMock, calls };
}

export const USERS = {
  operator: { id: 'u1', email: 'operator.demo@example.test', displayName: 'Demo Operator', role: 'COLLEGE_OPERATOR', institution: { id: 'i1', code: 'ABC-DEMO', name: 'ABC Institute of Technology (Demo)', regionId: 'REGION-DEMO' }, regionIds: [] },
  head: { id: 'u2', email: 'head.demo@example.test', displayName: 'Demo Head', role: 'COLLEGE_HEAD', institution: { id: 'i1', code: 'ABC-DEMO', name: 'ABC Institute of Technology (Demo)', regionId: 'REGION-DEMO' }, regionIds: [] },
  student: { id: 'u3', email: 'student.demo@example.test', displayName: 'Aarav Sharma', role: 'STUDENT', studentRef: 'SR-test', regionIds: [] },
  admin: { id: 'u4', email: 'admin.demo@example.test', displayName: 'Demo Admin', role: 'AICTE_SYSTEM_ADMIN', regionIds: [] },
};

export function signedOut() {
  return { 'GET /auth/me': { __status: 401, body: { error: { code: 'AUTH_REQUIRED', message: 'Please sign in.' } } } };
}

export function signedIn(user) {
  return { 'GET /auth/me': { user }, 'GET /notifications*': { items: [], unreadCount: 0, total: 0, page: 1, pageSize: 6, totalPages: 1 } };
}

/**
 * Renders `element` at `route`. Pass `path` (e.g. "/college/batches/:batchId") for pages that read params,
 * or `routes` (JSX <Route> elements) for a full route tree.
 */
export function renderWithProviders(element, { route = '/', path, routes } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Providers>
        {routes ? <Routes>{routes}</Routes> : path ? (
          // Signed-in pages are rendered behind ProtectedRoute, exactly as in the app, so the session loads first.
          <Routes><Route element={<ProtectedRoute />}><Route path={path} element={element} /></Route></Routes>
        ) : element}
      </Providers>
    </MemoryRouter>
  );
}
