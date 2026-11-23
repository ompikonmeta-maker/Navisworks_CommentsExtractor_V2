// Smoke test: open the built offline app (dist/index.html, as a user does by
// double-click), import the sample report, check every Work queue (and the
// Insights drill-down) lists exactly its count, open a comment, change its status,
// and check the change survives a reload; then add and delete a comment,
// re-import (merge + undo), check Help › About and reset to the sample.
// Fails on any page error.
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
  await page.locator('li.wb-row').first().waitFor();
  step(`opened ${path.relative(ROOT, APP)} — Work shows the bundled sample`);

  // Import the full sample report with its viewpoint images.
  const files = ['report.html', ...fs.readdirSync(SAMPLE).filter((f) => f.endsWith('.jpg'))].map((f) => path.join(SAMPLE, f));
  await page.locator('input[type=file][accept*=".html"]').setInputFiles(files);
  // First import: the summary shows before anything is saved.
  const sum = page.getByRole('dialog', { name: 'Check this import' });
  await sum.waitFor();
  for (const t of ['274 comments have no discipline', 'No duplicate comment IDs', '260', 'Most comments come from CPY']) {
    if (!(await sum.getByText(t, { exact: true }).count())) fail(`import summary: "${t}" missing`);
  }
  await sum.getByRole('button', { name: 'Save 747 comments' }).click();
  await page.getByText(/Imported 747 comments · \d+ images linked\./).waitFor();
  step('first import showed its summary (274 unassigned, 260 viewpoints, CPY on top), then saved 747 comments');

  // Work starts on the first Do-next queue; open All comments and the first one.
  const rows = page.locator('li.wb-row');
  const allQueue = async () => {
    await page.getByRole('button', { name: /^All comments/ }).click();
    await page.getByRole('heading', { name: 'All comments' }).waitFor();
  };
  // Every queue opens exactly the number of comments it shows.
  const queueButtons = page.getByRole('navigation', { name: 'Queues' }).getByRole('button');
  const nQueues = await queueButtons.count();
  if (nQueues !== 7) fail(`expected 7 queues, found ${nQueues}`);
  const counted = [];
  for (let i = 0; i < nQueues; i += 1) {
    const btn = queueButtons.nth(i);
    const n = Number((await btn.locator('.wb-queue-n').innerText()).trim());
    const label = (await btn.innerText()).replace(/\s+/g, ' ').trim();
    await btn.click();
    await page.waitForFunction((want) => document.querySelectorAll('li.wb-row').length === want, n);
    counted.push(`${label.replace(/\s*\d+$/, '')}: ${n}`);
  }
  step(`each queue lists exactly its count (${counted.join(', ')})`);
  // …and so does Insights' Do next.
  await page.getByRole('button', { name: 'Insights' }).first().click();
  await page.getByRole('button', { name: /Give these comments a discipline/ }).click();
  await page.getByRole('heading', { name: 'Give these comments a discipline' }).waitFor();
  const want = Number((await page.getByRole('navigation', { name: 'Queues' }).getByRole('button', { name: /Give a discipline/ }).locator('.wb-queue-n').innerText()).trim());
  await page.waitForFunction((n) => document.querySelectorAll('li.wb-row').length === n, want);
  step(`Insights › Do next opens the same ${want} comments in Work`);

  await allQueue();
  await page.waitForFunction(() => document.querySelectorAll('li.wb-row').length === 747);
  const first = rows.first();
  const viewpoint = (await first.locator('.wb-row-vp').innerText()).trim();
  await first.click();
  const drawer = page.getByRole('region', { name: 'Comment details' });
  await drawer.getByRole('heading', { name: viewpoint }).waitFor();
  step(`All comments: 747; opened comment "${viewpoint}"`);

  // Change its status to Closed.
  const status = drawer.getByRole('group', { name: 'Status' });
  await status.getByRole('button', { name: /Closed/ }).click();
  await status.locator('button[aria-pressed="true"]', { hasText: 'Closed' }).waitFor();
  await first.getByText('Closed', { exact: true }).waitFor();
  step('status changed to Closed (drawer and list agree)');

  // Autosave (IndexedDB) is debounced; wait for it, then reload.
  await page.waitForTimeout(1500);
  await page.reload();
  await rows.first().waitFor();
  await allQueue();
  await page.waitForFunction(() => document.querySelectorAll('li.wb-row').length === 747);
  await rows.filter({ hasText: viewpoint }).first().getByText('Closed', { exact: true }).waitFor();
  step('after reload: still 747 comments, the change was kept');

  // Add a comment by hand, then delete it.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByPlaceholder('e.g. CPY_Dito: Provide access platform for the valve').fill('CPY_Dito: PIP to add a pipe support');
  await page.getByRole('dialog').getByRole('button', { name: 'Add comment' }).click();
  await page.getByText('Comment added.').waitFor();
  await drawer.getByRole('heading', { name: 'Manual' }).waitFor();
  if ((await rows.count()) !== 748) fail(`after adding: ${await rows.count()} rows, expected 748`);
  await drawer.getByRole('button', { name: 'Delete this comment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete comment' }).click();
  await page.getByText('Comment deleted.').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('li.wb-row').length === 747);
  step('added a comment by hand (748), deleted it again (747)');

  // Re-import the same report: a merge that changes nothing, then Undo.
  await page.locator('input[type=file][accept*=".html"]').setInputFiles(files);
  await page.getByRole('button', { name: 'Update review' }).click();
  await page.getByText('Review updated: 0 added, 0 changed.').waitFor();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByText('Import undone.').waitFor();
  await allQueue();
  await rows.filter({ hasText: viewpoint }).first().getByText('Closed', { exact: true }).waitFor();
  if ((await rows.count()) !== 747) fail(`after merge + undo: ${await rows.count()} rows, expected 747`);
  step('re-import merged (0 added, 0 changed) and Undo kept the work');

  // Set the review target from the Work strip; the headline then talks pace.
  const target = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  await page.getByRole('button', { name: 'Work' }).first().click();
  await page.getByRole('button', { name: /Set a target/ }).click();
  await page.locator('#ov-target').fill(target);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText(/Target \d/).first().waitFor();
  await page.getByText(/^(\d+ days? behind\.|Over a year behind\.|On track\.|\d+ comments? to close in \d+ days?\.)$/).waitFor();
  step(`target set from the Work strip; headline: "${(await page.locator('.wb-headline').innerText()).trim()}"`);

  // Help › About says how the app runs.
  await page.getByRole('button', { name: 'Help' }).first().click();
  await page.getByRole('button', { name: 'About' }).click();
  await page.getByText('Runs fully in your browser').waitFor();
  step('Help › About: runs in the browser');

  // Reset to the bundled sample (confirms with a browser dialog).
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Reset to sample' }).click();
  await page.getByText('Reset to sample.').waitFor();
  await page.getByRole('button', { name: 'Work' }).first().click();
  await allQueue();
  await page.waitForFunction(() => document.querySelectorAll('li.wb-row').length === 10);
  step('reset to the sample: 10 comments');

  if (errors.length) fail(`the page reported errors:\n${errors.join('\n')}`);
  console.log('\nSMOKE OK');
} catch (e) {
  console.error(`\nSMOKE FAILED: ${e.message}`);
  if (errors.length && !e.message.includes('reported errors')) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
