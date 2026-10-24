// Shared helpers for the optional browser checks (headless Chrome via puppeteer-core).
import fs from 'fs';
import puppeteer from 'puppeteer-core';

export const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
export const PASSWORD = process.env.E2E_PASSWORD || process.env.DEMO_PASSWORD;

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  const found = candidates.find((path) => fs.existsSync(path));
  if (!found) throw new Error('No Chrome/Chromium found. Install Chrome or set CHROME_PATH.');
  return found;
}

export async function launch() {
  if (!PASSWORD) {
    console.error('Set E2E_PASSWORD to the DEMO_PASSWORD used when seeding (see e2e/README.md).');
    process.exit(2);
  }
  return puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'] });
}

// Collects runtime problems. The browser also logs every non-2xx fetch as a console error; expected
// business responses that the UI handles (401/403 probes, 409 conflicts, 422 validation) are ignored here
// because each step asserts the visible outcome instead.
export function watch(page, label, problems) {
  page.on('pageerror', (error) => problems.push(`[${label}] PAGE ERROR: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/(401|403|409|422) \((Unauthorized|Forbidden|Conflict|Unprocessable)/.test(msg.text())) problems.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`[${label}] HTTP ${response.status()} ${response.url()}`);
  });
}

export async function login(context, email, label, problems) {
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  watch(page, label, problems);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.type('#login-email', email);
  await page.type('#login-password', PASSWORD);
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 15000 }).catch(() => {});
  return page;
}
