// Date helpers. Dates in the CSV are plain ISO calendar dates (YYYY-MM-DD).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACADEMIC_YEAR = /^(\d{4})-(\d{2})$/;

// Returns true for a real calendar date such as 2026-08-01 (rejects 2026-02-30).
function isValidIsoDate(text) {
  if (typeof text !== 'string' || !ISO_DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

// "2026-27" is valid only when the second part is the following year.
function isValidAcademicYear(text) {
  const match = ACADEMIC_YEAR.exec(String(text || ''));
  if (!match) return false;
  const start = Number(match[1]);
  return (start + 1) % 100 === Number(match[2]);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

module.exports = { isValidIsoDate, isValidAcademicYear, todayIsoDate, addDays };
