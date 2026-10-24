// Tiny structured logger. Writes one JSON line per event so logs are easy to search.
// Never pass passwords, session IDs, tokens, full student identifiers or request bodies here.

function write(level, message, details) {
  if (process.env.NODE_ENV === 'test' && level !== 'error' && process.env.LOG_IN_TESTS !== 'true') return;
  const entry = { time: new Date().toISOString(), level, message, ...(details || {}) };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  info: (message, details) => write('info', message, details),
  warn: (message, details) => write('warn', message, details),
  error: (message, details) => write('error', message, details),
};
