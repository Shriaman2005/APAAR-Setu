// Bounded pagination for every list endpoint (spec 06 section 6).
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function readPagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function pageResult(items, total, { page, pageSize }) {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Escapes user search text before it is used inside a regular expression.
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns a trimmed search string (max 60 chars) or null.
function readSearch(query = {}) {
  if (typeof query.search !== 'string') return null;
  const trimmed = query.search.trim().slice(0, 60);
  return trimmed.length > 0 ? trimmed : null;
}

module.exports = { readPagination, pageResult, escapeRegex, readSearch, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
