// Masking helpers so lists, exports and logs do not show full identifiers by default.

// "111111111111" -> "********1111"
function maskIdentifier(value, visible = 4) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= visible) return '*'.repeat(text.length);
  return '*'.repeat(text.length - visible) + text.slice(-visible);
}

// "SR-6f1c...-a1b2c3" -> "SR-…a1b2c3"
function maskStudentRef(ref) {
  if (!ref) return '';
  const text = String(ref);
  return `${text.slice(0, 3)}…${text.slice(-6)}`;
}

// "Aarav Sharma" -> "A. S."
function initials(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(' ');
}

// "PHONE-DEMO-SHARED" -> "PHONE-***ARED"
function maskToken(token) {
  if (!token) return '';
  const text = String(token);
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 6)}***${text.slice(-4)}`;
}

module.exports = { maskIdentifier, maskStudentRef, initials, maskToken };
