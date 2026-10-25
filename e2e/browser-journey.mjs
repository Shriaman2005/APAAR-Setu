// Optional browser end-to-end journey across roles (see e2e/README.md).
// Uses a running app (npm run dev) with seeded synthetic data. It creates synthetic records.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BASE, launch, login, watch } from './browserSetup.mjs';

const problems = [];
const results = [];
const SHOTS = path.resolve('e2e/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

async function step(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const FIXTURES = path.resolve('fixtures');

// Uploads a CSV through the wizard. Returns the batch page URL, or null if the server reports that this
// exact file was already uploaded in this database (so re-runs do not fail).
async function uploadThroughWizard(page, csvPath) {
  await page.goto(`${BASE}/college/upload`, { waitUntil: 'networkidle0' });
  await (await page.$('input[type="file"][accept=".csv,text/csv"]')).uploadFile(csvPath);
  await page.locator('::-p-text(Run pre-check)').click();
  await page.waitForSelector('::-p-text(Pre-check passed)');
  await page.locator('button::-p-text(Submit upload)').click();
  const outcome = await Promise.race([
    page.waitForSelector('::-p-text(Batch received)', { timeout: 15000 }).then(() => 'created'),
    page.waitForSelector('::-p-text(This exact file was already uploaded)', { timeout: 15000 }).then(() => 'duplicate'),
  ]);
  if (outcome === 'duplicate') return null;
  await page.locator('::-p-text(View batch and validation results)').click();
  await page.waitForFunction(() => !/Validating/.test(document.querySelector('main')?.textContent || '') || /Needs correction|Validated/.test(document.body.textContent), { timeout: 20000 });
  return page.url();
}

async function markReady(page) {
  await page.waitForSelector('::-p-text(Ready to hand over)', { timeout: 20000 });
  await page.locator('button::-p-text(Mark ready for review)').click();
  await page.locator('[role="dialog"] button::-p-text(Mark ready for review)').click();
  await page.waitForSelector('::-p-text(Ready for review)');
}

async function certify(page, url) {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('::-p-text(Seat ledger impact if certified now)');
  // College head (checker) accepts justified warning dispositions, if any.
  const selectAll = await page.$('button::-p-text(Select all justified on this page)');
  if (selectAll) {
    await selectAll.click();
    await page.locator('button::-p-text(Accept selected dispositions)').click();
    await page.waitForSelector('[role="dialog"] textarea');
    await page.type('[role="dialog"] textarea', 'Justifications reviewed (synthetic test).');
    await page.locator('[role="dialog"] button::-p-text(Accept dispositions)').click();
    await page.waitForSelector('::-p-text(disposition(s) accepted)', { timeout: 10000 });
    await page.waitForSelector('::-p-text(Ready to certify)', { timeout: 10000 });
  }
  await page.locator('button::-p-text(Certify and submit)').click();
  await page.click('[role="dialog"] input[type="checkbox"]');
  await page.type('[role="dialog"] input[type="text"]', url.split('/').pop());
  await page.locator('[role="dialog"] button::-p-text(Certify and submit)').click();
  await page.waitForSelector('::-p-text(Certified and committed)', { timeout: 20000 });
}

const browser = await launch();
let batchUrl = null;
try {
  const visitor = await browser.createBrowserContext();
  const home = await visitor.newPage();
  watch(home, 'public', problems);
  await step('home page renders on desktop and mobile without horizontal scrolling', async () => {
    await home.setViewport({ width: 1280, height: 900 });
    await home.goto(BASE, { waitUntil: 'networkidle0' });
    await home.waitForSelector('::-p-text(Welcome to APAAR Setu)');
    await shot(home, 'home-desktop');
    await home.setViewport({ width: 390, height: 844, isMobile: true });
    await home.reload({ waitUntil: 'networkidle0' });
    if (await home.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('horizontal overflow');
    await shot(home, 'home-mobile');
  });
  await step('text size, high contrast and Hindi controls', async () => {
    await home.setViewport({ width: 1280, height: 900 });
    await home.goto(BASE, { waitUntil: 'networkidle0' });
    await home.click('button[aria-label="Increase text size"]');
    await home.click('::-p-text(High contrast)');
    await home.select('#language-select', 'hi');
    await home.waitForSelector('::-p-text(मुख पृष्ठ)');
    await home.select('#language-select', 'en');
    await home.click('::-p-text(High contrast)');
    await home.click('button[aria-label="Reset text size"]');
  });
  await step('login validation and generic error', async () => {
    await home.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await home.click('button[type="submit"]');
    await home.waitForSelector('::-p-text(Enter your email address.)');
    await home.type('#login-email', 'operator.demo@example.test');
    await home.type('#login-password', 'Wrong-Password-1');
    await home.click('button[type="submit"]');
    await home.waitForSelector('::-p-text(The email or password is incorrect)');
  });
  await step('public verify reports an invented reference as invalid', async () => {
    await home.goto(`${BASE}/verify/CRD-00000000000000000000000000000000-000000000000`, { waitUntil: 'networkidle0' });
    await home.waitForSelector('::-p-text(Invalid or tampered)');
  });
  await visitor.close();

  // Operator uploads the clean fixture and an over-capacity file; the head certifies both.
  const operatorContext = await browser.createBrowserContext();
  const headContext = await browser.createBrowserContext();
  let cleanUrl = null;
  await step('operator uploads clean_batch.csv and marks it ready (skipped if already uploaded)', async () => {
    const page = await login(operatorContext, 'operator.demo@example.test', 'operator', problems);
    cleanUrl = await uploadThroughWizard(page, path.join(FIXTURES, 'clean_batch.csv'));
    if (cleanUrl) await markReady(page);
    await page.close();
  });
  await step('college head certifies the clean batch', async () => {
    const page = await login(headContext, 'head.demo@example.test', 'head', problems);
    if (cleanUrl) await certify(page, cleanUrl);
    await page.close();
  });
  await step('operator uploads an over-capacity file, corrects a row and marks it ready', async () => {
    const page = await operatorContext.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    watch(page, 'operator', problems);
    const stamp = Date.now().toString().slice(-6);
    // Fresh 12-digit identifiers each run (not in the mock registry), so re-runs never collide with
    // identities committed earlier. They raise L2_MOCK_ID_NOT_FOUND warnings that must be justified.
    const idBase = `5${Date.now().toString().slice(-9)}0`;
    // Size the file from the live ledger so exactly one row exceeds the NRI capacity on every run.
    await page.goto(`${BASE}/college`, { waitUntil: 'networkidle0' });
    const remaining = await page.evaluate(async () => {
      const ledger = await (await fetch('/api/institutions/ABC-DEMO/seat-ledger?academicYear=2026-27', { credentials: 'include' })).json();
      const nri = ledger.buckets.find((b) => b.courseCode === 'CSE' && b.bucketCode === 'NRI');
      return nri.capacity - nri.filled;
    });
    const names = ['Asha Verma', 'Bina Rao', 'Chirag Das', 'Dina Shah', 'Esha Gupta', 'Farid Khan'];
    const rows = names.slice(0, remaining + 1)
      .map((name, i) => `E2E-${stamp}-${i},${name},CSE,2026-27,NRI,${idBase}${i},PHONE-E2E-${i},1,2026-08-1${i}`);
    const csvPath = path.join(os.tmpdir(), `apaar-e2e-${stamp}.csv`);
    fs.writeFileSync(csvPath, `studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn\n${rows.join('\n')}\n`);
    batchUrl = await uploadThroughWizard(page, csvPath);
    await page.waitForSelector('::-p-text(L4_BUCKET_CAPACITY_EXCEEDED)', { timeout: 20000 });
    await shot(page, 'operator-batch-errors');
    const overflowRow = await page.evaluate(() => [...document.querySelectorAll('main table tbody tr')]
      .find((tr) => tr.textContent.includes('L4_BUCKET_CAPACITY_EXCEEDED'))?.querySelector('td button')?.textContent.trim());
    await page.locator(`button::-p-text(${overflowRow})`).click();
    await page.waitForSelector('#row-bucketCode');
    await page.click('#row-bucketCode');
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#row-bucketCode', 'REGULAR');
    if (await page.$eval('#row-bucketCode', (el) => el.value) !== 'REGULAR') throw new Error('typing lost focus');
    await page.locator('button::-p-text(Save correction)').click();
    await page.waitForSelector('::-p-text(saved to staging)');
    await page.locator('button::-p-text(Revalidate changed rows)').click();
    // Wait until the SERVER reports the background revalidation finished, then load a fresh view
    // (buttons from the previous view must not be clicked while the batch is VALIDATING).
    const batchId = batchUrl.split('/').pop();
    await page.waitForFunction(async (id) => {
      const response = await fetch(`/api/batches/${id}`, { credentials: 'include' });
      const body = await response.json();
      return !['UPLOADED', 'VALIDATING'].includes(body.batch.status) && body.batch.validationRunCount >= 2;
    }, { timeout: 20000, polling: 500 }, batchId);
    await page.reload({ waitUntil: 'networkidle0' });
    // Operator (maker) justifies each warning for the college head.
    for (let i = 0; i < 10; i += 1) {
      const justify = await page.$('button::-p-text(Justify)');
      if (!justify) break;
      await justify.click();
      await page.waitForSelector('[role="dialog"] textarea');
      await page.type('[role="dialog"] textarea', 'Identifier checked against the admission file (synthetic test).');
      await page.locator('[role="dialog"] button::-p-text(Save justification)').click();
      await page.waitForSelector('[role="dialog"]', { hidden: true });
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => {});
    }
    await markReady(page);
    await page.close();
  });
  await step('college head certifies the corrected batch', async () => {
    if (!batchUrl) throw new Error('no batch from the previous step');
    const page = await headContext.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    watch(page, 'head', problems);
    await certify(page, batchUrl);
    await shot(page, 'head-committed');
    await page.close();
  });
  await operatorContext.close();
  await headContext.close();

  const nationalContext = await browser.createBrowserContext();
  await step('national officer: dashboard drill-down, risk case, audit verification', async () => {
    const page = await login(nationalContext, 'national.demo@example.test', 'national', problems);
    await page.waitForSelector('::-p-text(Breakdown by region)');
    await page.locator('table button::-p-text(Demo Region North)').click();
    await page.waitForSelector('::-p-text(Breakdown by institution)');
    await page.goto(`${BASE}/aicte/risk`, { waitUntil: 'networkidle0' });
    await page.locator('a::-p-text(RISK-)').click();
    await page.waitForSelector('::-p-text(How the score is computed)');
    await page.goto(`${BASE}/aicte/audit`, { waitUntil: 'networkidle0' });
    await page.locator('button::-p-text(Verify chain)').click();
    await page.locator('[role="dialog"] button::-p-text(Run verification)').click();
    await page.waitForSelector('::-p-text(Integrity check:)', { timeout: 20000 });
    await shot(page, 'national-audit');
  });
  await nationalContext.close();

  const studentContext = await browser.createBrowserContext();
  const verifierContext = await browser.createBrowserContext();
  await step('verifier request, student approval, approved-only result', async () => {
    const student = await login(studentContext, 'student.demo@example.test', 'student', problems);
    await student.waitForSelector('::-p-text(Verification reference)');
    const studentRef = await student.$eval('code.mono', (el) => el.textContent.trim());
    const verifier = await login(verifierContext, 'verifier.demo@example.test', 'verifier', problems);
    await verifier.goto(`${BASE}/verifier/requests/new`, { waitUntil: 'networkidle0' });
    await (await verifier.$$('main input.form-control'))[0].type(studentRef);
    await (await verifier.$('main select:has(option[value="SCHOLARSHIP_VERIFICATION"])')).select('SCHOLARSHIP_VERIFICATION');
    await verifier.click('#field-displayName');
    await verifier.click('#field-enrolmentStatus');
    await verifier.locator('button::-p-text(Submit request)').click();
    await verifier.waitForSelector('::-p-text(View approved result)', { timeout: 10000 });
    await student.goto(`${BASE}/student/consents`, { waitUntil: 'networkidle0' });
    await student.locator('button::-p-text(Approve)').click();
    await student.locator('[role="dialog"] button::-p-text(Approve selected fields)').click();
    await student.waitForSelector('::-p-text(Consent approved)', { timeout: 10000 });
    await verifier.reload({ waitUntil: 'networkidle0' });
    await verifier.locator('button::-p-text(View approved result)').click();
    await verifier.waitForSelector('::-p-text(Retrieved)', { timeout: 10000 });
    await shot(verifier, 'verifier-result');
  });
  await studentContext.close();
  await verifierContext.close();

  const issuerContext = await browser.createBrowserContext();
  await step('issuer credential and public VALID status', async () => {
    const page = await login(issuerContext, 'issuer.demo@example.test', 'issuer', problems);
    await page.type('#iss-search', 'STU-003');
    await page.locator('button::-p-text(Search eligible student)').click();
    await page.locator('a::-p-text(View permitted details)').click();
    await page.waitForSelector('::-p-text(Minimum fields for issuance)');
    const generate = await page.$('button::-p-text(Generate Enrolment certificate)');
    if (generate && !(await generate.evaluate((el) => el.disabled))) {
      await generate.click();
      await page.locator('[role="dialog"] button::-p-text(Generate credential)').click();
    }
    await page.waitForSelector('img[alt^="QR code"]', { timeout: 15000 });
    const ref = await page.$eval('span.mono', (el) => el.textContent.trim());
    await page.goto(`${BASE}/verify/${ref}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('::-p-text(Verification mode)', { timeout: 10000 });
    await shot(page, 'public-verify');
  });
  await issuerContext.close();
} finally {
  await browser.close();
}

console.log(results.join('\n'));
console.log(problems.length ? `\nPROBLEMS:\n${[...new Set(problems)].join('\n')}` : '\nNo console errors, page errors or 5xx responses.');
process.exit(results.some((r) => r.startsWith('FAIL')) || problems.length ? 1 : 0);
