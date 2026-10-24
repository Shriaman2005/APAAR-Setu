# Optional browser checks

These scripts drive the real UI in headless Chrome (via `puppeteer-core`, which uses your installed
Chrome - no browser download). They are **not** part of `npm test` because they need a running app.

1. Start the database, seed with a known development password and run the app:
   ```bash
   npm run db:dev                                   # terminal 1
   # put DEMO_PASSWORD=Some-Dev-Password-2026 in .env, then (on a fresh demo database):
   npm --prefix server run demo:reset -- --confirm  # or: npm run seed
   npm run dev                                      # terminal 2
   ```
2. Run the checks (terminal 3):
   ```bash
   E2E_PASSWORD=Some-Dev-Password-2026 npm run test:browser
   ```

- `browser-journey.mjs` - home/mobile/accessibility controls, login validation, upload → correct →
  revalidate → mark ready (operator), certify (head), dashboard drill-down + risk case + audit check
  (national), consent request/approval/result (verifier + student), credential + public status (issuer).
- `route-sweep.mjs` - signs in as each role and opens every route, failing on page errors, console
  errors, HTTP 5xx or error alerts.

Options: `E2E_BASE_URL` (default `http://localhost:5173`), `CHROME_PATH`. Screenshots go to
`e2e/screenshots/` (ignored by Git). The journey creates synthetic records, so use a demo database;
for the cleanest result run it right after `demo:reset`.
