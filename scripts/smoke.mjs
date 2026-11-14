// Smoke test: open the built offline app (dist/index.html, as a user does by
// double-click), import the sample report, open a comment, change its status,
// and check the change survives a reload. Fails on any page error.
// Run with `npm run smoke` (builds first).
//
// Uses the Chromium that is already installed (no `playwright install`):
// set CHROME_PATH to point elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP = path.join(ROOT, 'dist/index.html');
const URL_ = pathToFileURL(APP).href;
const SAMPLE = path.join(ROOT, 'src/sample');
const CANDIDATES = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium'].filter(Boolean);

const step = (msg) => console.log(`  • ${msg}`);
function fail(msg) { throw new Error(msg); }

if (!fs.existsSync(APP)) fail('dist/index.html is missing — run `npm run build` first.');

let browser;
const errors = [];
try {
  const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
  if (!executablePath) fail('No Chromium found — set CHROME_PATH.');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
  page.setDefaultTimeout(15000);

  await page.goto(URL_);
  await page.getByRole('button', { name: 'Import', exact: true }).waitFor();
  step(`opened ${path.relative(ROOT, APP)} — Overview shows the bundled sample`);

  // Import the full sample report with its viewpoint images.
  const files = ['report.html', ...fs.readdirSync(SAMPLE).filter((f) => f.endsWith('.jpg'))].map((f) => path.join(SAMPLE, f));
  await page.locator('input[type=file][accept*=".html"]').setInputFiles(files);
  await page.getByText(/Imported 747 comments · \d+ images linked\./).waitFor();
  step('imported the sample report: 747 comments');

  // Open the first comment in Viewpoints.
  await page.getByRole('button', { name: 'Viewpoints' }).first().click();
  const rows = page.locator('tr.vp-row');
  await rows.first().waitFor();
  const rowCount = await rows.count();
  if (rowCount !== 747) fail(`Viewpoints shows ${rowCount} rows, expected 747`);
  const first = rows.first();
  const viewpoint = (await first.locator('td').nth(1).innerText()).trim();
  await first.click();
  const drawer = page.getByRole('dialog', { name: 'Viewpoint detail' });
  await drawer.getByRole('heading', { name: viewpoint }).waitFor();
  step(`opened comment "${viewpoint}"`);

  // Change its status to Closed.
  const status = drawer.getByRole('group', { name: 'Status' });
  await status.getByRole('button', { name: /Closed/ }).click();
  await status.locator('button[aria-pressed="true"]', { hasText: 'Closed' }).waitFor();
  await first.getByText('Closed', { exact: true }).waitFor();
  step('status changed to Closed (drawer and list agree)');

  // Autosave (IndexedDB) is debounced; wait for it, then reload.
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole('button', { name: 'Viewpoints' }).first().click();
  await rows.first().waitFor();
  const afterReload = await rows.count();
  if (afterReload !== 747) fail(`after reload: ${afterReload} rows, expected 747`);
  await rows.filter({ hasText: viewpoint }).first().getByText('Closed', { exact: true }).waitFor();
  step('after reload: still 747 comments, the change was kept');

  if (errors.length) fail(`the page reported errors:\n${errors.join('\n')}`);
  console.log('\nSMOKE OK');
} catch (e) {
  console.error(`\nSMOKE FAILED: ${e.message}`);
  if (errors.length && !e.message.includes('reported errors')) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
