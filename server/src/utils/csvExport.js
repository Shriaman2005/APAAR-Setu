// Builds CSV text for downloads.
// Values starting with = + - @ (or tab/carriage return) are prefixed with a single quote so a
// spreadsheet does not run them as formulas ("CSV injection").

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * @param {string[]} headers column names
 * @param {Array<Object>} rows objects keyed by header name
 */
function toCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(headers.map((header) => escapeCell(row[header])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function sendCsv(res, filename, csvText) {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csvText);
}

module.exports = { toCsv, sendCsv, escapeCell };
