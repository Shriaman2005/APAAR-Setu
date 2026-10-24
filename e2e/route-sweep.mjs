// Optional browser check: signs in as every role and visits every route (see e2e/README.md).
import { BASE, PASSWORD, launch } from './browserSetup.mjs';
import fs from 'fs';

fs.mkdirSync('e2e/screenshots/routes', { recursive: true });

async function apiJson(page, path) {
  return page.evaluate(async (p) => (await fetch(`/api${p}`, { credentials: 'include' })).json(), path);
}

const ROLES = {
  'operator.demo@example.test': async (page) => {
    const batches = await apiJson(page, '/batches?pageSize=1');
    const conflicts = await apiJson(page, '/conflicts');
    return ['/college', '/college/upload', '/college/batches', `/college/batches/${batches.items[0].batchId}`, '/college/seat-ledger', '/college/register',
      '/college/conflicts', `/college/conflicts/${conflicts.items[0]?.conflictId}`, '/college/correction-requests', '/notifications', '/account', '/help'];
  },
  'head.demo@example.test': async () => ['/college', '/college/batches?status=READY_FOR_REVIEW', '/college/batches/BATCH-ABC-DEMO-SEED-STALE', '/college/register', '/college/correction-requests', '/college/audit', '/college/seat-ledger'],
  'national.demo@example.test': async (page) => {
    const policies = await apiJson(page, '/admin/seat-policies');
    const [a, b] = policies.items;
    const institutions = await apiJson(page, '/institutions');
    return ['/aicte', '/aicte?regionId=REGION-DEMO', `/aicte?institutionId=${institutions.items[0].id}`, '/aicte/risk', '/aicte/conflicts', '/aicte/register', '/aicte/audit', '/aicte/policies',
      `/aicte/policies/${a.id}`, `/aicte/policies/compare?from=${a.id}&to=${b.id}`, `/aicte/institutions/${institutions.items[0].id}/seat-ledger`];
  },
  'regional.demo@example.test': async () => ['/aicte', '/aicte/risk', '/aicte/conflicts', '/aicte/register', '/aicte/audit'],
  'admin.demo@example.test': async (page) => {
    const policies = await apiJson(page, '/admin/seat-policies');
    const draft = policies.items.find((p) => p.status !== 'PUBLISHED') || policies.items[0];
    return ['/admin', '/admin/users', '/admin/organisations', '/admin/policies', '/admin/policies/new', `/admin/policies/${draft.id}`, '/admin/settings', '/admin/audit', '/admin/ledger-check'];
  },
  'issuer.demo@example.test': async (page) => {
    const eligible = await apiJson(page, '/issuer/eligible-students');
    const creds = await apiJson(page, '/credentials');
    const list = ['/issuer', '/issuer/credentials', `/issuer/students/${eligible.items[0].enrolmentRef}`];
    if (creds.items[0]) list.push(`/credentials/${creds.items[0].credentialRef}/print`);
    return list;
  },
  'verifier.demo@example.test': async (page) => {
    const requests = await apiJson(page, '/verification-requests');
    return ['/verifier', '/verifier/onboarding', '/verifier/requests/new', ...(requests.items[0] ? [`/verifier/requests/${requests.items[0].requestId}`] : [])];
  },
  'student.demo@example.test': async () => ['/student', '/student/consents', '/student/access-log', '/student/credentials', '/student/corrections', '/verify', '/does-not-exist', '/admin'],
};

const browser = await launch();
const report = [];
let failures = 0;
try {
  for (const [email, routesFor] of Object.entries(ROLES)) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`PAGE ERROR ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/401 \(Unauthorized\)|403 \(Forbidden\)/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await page.type('#login-email', email);
    await page.type('#login-password', PASSWORD);
    await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 }), page.click('button[type="submit"]')]);
    const routes = await routesFor(page);
    for (const route of routes) {
      const before = problems.length;
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 300));
      const info = await page.evaluate(() => ({
        h1: document.querySelector('main h1')?.textContent?.trim() || null,
        errorAlert: [...document.querySelectorAll('.alert-gov.error strong')].map((el) => el.textContent).find((t) => t === 'Something went wrong') ? document.querySelector('.alert-gov.error')?.textContent?.slice(0, 160) : null,
        path: location.pathname,
      }));
      const name = `${email.split('@')[0]}${route.replace(/[^a-z0-9]+/gi, '_')}`.slice(0, 90);
      await page.screenshot({ path: `e2e/screenshots/routes/${name}.png`, fullPage: false });
      const ok = info.h1 && !info.errorAlert && problems.length === before;
      if (!ok) failures += 1;
      report.push(`${ok ? 'OK  ' : 'FAIL'} ${email.split('@')[0].padEnd(14)} ${route.padEnd(60)} -> ${info.path} | h1="${info.h1}"${info.errorAlert ? ` | ERROR ALERT: ${info.errorAlert}` : ''}${problems.length > before ? ` | ${problems.slice(before).join(' ; ')}` : ''}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(report.join('\n'));
console.log(`\n${failures} failing route(s) out of ${report.length}.`);
process.exit(failures ? 1 : 0);
