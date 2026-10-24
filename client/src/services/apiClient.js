// Small wrapper around fetch for the Express API.
// - Sends the session cookie (credentials: 'include'); no token is ever kept in localStorage.
// - Adds the CSRF token header to every state-changing request.
// - Turns error responses into ApiError objects with the server's safe code and message.

let csrfToken = null;

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setCsrfToken(token) {
  csrfToken = token || null;
}

async function fetchCsrfToken() {
  const response = await fetch('/api/auth/csrf-token', { credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status, 'CSRF_UNAVAILABLE', 'Could not start a secure session. Refresh the page.');
  const data = await response.json();
  csrfToken = data.csrfToken;
  return csrfToken;
}

function notifyUnauthorized(code) {
  window.dispatchEvent(new CustomEvent('apaar:unauthorized', { detail: { code } }));
}

async function readError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = body?.error || {};
  return new ApiError(response.status, error.code || `HTTP_${response.status}`, error.message || `The request failed (status ${response.status}).`, error.details);
}

/**
 * @param {string} path API path after /api, e.g. "/batches"
 * @param {{ method?: string, body?: object, formData?: FormData, headers?: object, retryCsrf?: boolean }} options
 */
export async function api(path, { method = 'GET', body, formData, headers = {}, retryCsrf = true } = {}) {
  const options = { method, credentials: 'include', headers: { Accept: 'application/json', ...headers } };
  if (method !== 'GET' && method !== 'HEAD') {
    options.headers['X-CSRF-Token'] = csrfToken || (await fetchCsrfToken());
  }
  if (formData) options.body = formData;
  else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the APAAR Setu server. Check that the API is running, then try again.');
  }

  if (!response.ok) {
    const error = await readError(response);
    // A missing/expired CSRF token: fetch a fresh one and retry once.
    if (error.code === 'CSRF_TOKEN_INVALID' && retryCsrf) {
      await fetchCsrfToken();
      return api(path, { method, body, formData, headers, retryCsrf: false });
    }
    if (error.status === 401 && path !== '/auth/login' && path !== '/auth/me') notifyUnauthorized(error.code);
    throw error;
  }
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
}

/**
 * Downloads a file from a GET endpoint (CSV exports, QR images) using the session cookie.
 */
export async function downloadFile(path, fallbackName) {
  let response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server to download the file.');
  }
  if (!response.ok) throw await readError(response);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Fetches an image (e.g. a QR code) and returns an object URL the page can show.
export async function fetchImageUrl(path) {
  const response = await fetch(`/api${path}`, { credentials: 'include' });
  if (!response.ok) throw await readError(response);
  return URL.createObjectURL(await response.blob());
}

export function toQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
