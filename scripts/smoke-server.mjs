// Server smoke test: two people on the office server edit the same comment.
//   1. Boss (admin) changes the status; Rina (reviewer) still has the old copy
//      and types a resolution → her save is refused, she sees Boss's status,
//      her text stays in the field, and "Save mine" saves it.
//   2. Boss sees Rina's resolution appear by itself (the 30-second refresh).
//   3. A plain conflict (no resolution) just shows the newer values.
//   4. Roles and shared data: the review target comes from the server, a
//      reviewer has no Import or Delete, an admin sees history, uploads the
//      project template, imports the sample report (merge + Undo), and adds
//      and deletes a comment.
//   5–7. Trash (Undo, restore, delete for good), Settings › Backup download,
//      and "Who can open…" hiding / giving back a project.
// Fails on any page error. Run with `npm run smoke:server` — it builds the app,
// copies it into server/web/ (what the server embeds) and builds the server.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.SMOKE_PORT || 18787);
const BASE = `http://127.0.0.1:${PORT}`;
const CANDIDATES = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium'].filter(Boolean);
const CONFLICT = 'Someone else changed this comment — showing the latest.';

const step = (msg) => console.log(`  • ${msg}`);
const fail = (msg) => { throw new Error(msg); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabelin-smoke-'));
let server;
let browser;
const errors = [];

// ---- tiny API client (node fetch + one session cookie) ----
async function signIn(username, pin) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pin }) });
  if (!res.ok) fail(`login ${username}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (method, p, body) => {
    const r = await fetch(`${BASE}${p}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) fail(`${method} ${p}: ${r.status} ${await r.text()}`);
    return r.json();
  };
  return { cookie: cookie.split('='), call };
}

try {
  // ---- build and start the server on a temporary data folder ----
  const bin = path.join(tmp, process.platform === 'win32' ? 'tabelin-server.exe' : 'tabelin-server');
  execFileSync('go', ['build', '-o', bin, '.'], { cwd: path.join(ROOT, 'server'), stdio: 'inherit' });
  server = spawn(bin, [], {
    env: { ...process.env, TABELIN_DATA: path.join(tmp, 'data'), TABELIN_ADDR: `127.0.0.1:${PORT}`, TABELIN_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; ; i += 1) {
    if (server.exitCode != null) fail(`server exited:\n${log}`);
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* not up yet */ }
    if (i > 100) fail(`server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  step(`server running at ${BASE}`);

  // ---- set up: a project, a review with three comments, a reviewer ----
  const boss = await signIn('admin', '1111'); // the first sign-in sets the PIN
  const project = await boss.call('POST', '/api/projects', { name: 'Smoke project' });
  const review = await boss.call('POST', `/api/projects/${project.id}/reviews`, { name: 'Smoke review' });
  await boss.call('POST', '/api/users', { username: 'rina', displayName: 'Rina', role: 'reviewer' });
  const rina = await signIn('rina', '2222');
  const recs = ['First', 'Second', 'Third'].map((t, i) => ({
    commentId: String(100 + i), viewpoint: `Tag View ${i + 1}`, commentRaw: `CPY_Dito: ${t} comment`, commentText: `${t} comment`,
    status: 'Open', discipline: 'PIP', commenter: 'CPY_Dito', commentDate: '2025/1/5 09:00:00', source: 'smoke.html',
  }));
  const { ids } = await boss.call('POST', `/api/reviews/${review.id}/records`, { records: recs });
  await boss.call('PUT', `/api/reviews/${review.id}/config`, { key: 'reviewTarget', json: '2030-01-31' });
  step('project, review with 3 comments and a target, and a reviewer created');

  // ---- two browsers, each signed in, opening the same review ----
  const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
  if (!executablePath) fail('No Chromium found — set CHROME_PATH.');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const last = JSON.stringify({ project: { id: project.id, name: project.name }, review: { id: review.id, name: review.name } });
  async function open(who, session) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await ctx.addCookies([{ name: session.cookie[0], value: session.cookie[1], url: BASE }]);
    await ctx.addInitScript((v) => localStorage.setItem('tabelin.lastReview', v), last);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(`${who}: page error: ${e.message}`));
    // Failed requests are checked one by one; two kinds are expected: a
    // refused save (409) and asking whether the project has a template yet
    // (HEAD/GET …/template → 404, from the setup checklist and the Template
    // panel). The browser also logs every failed request as a console error,
    // so those lines are left to this check.
    page.on('response', (r) => {
      if (r.status() < 400) return;
      const m = r.request().method();
      // …and a project hidden from her (step 7): her last review answers 404 and
      // the app falls back to the project list.
      const expected = (r.status() === 409 && m === 'PATCH') || (r.status() === 404 && /\/template$/.test(r.url()))
        || (r.status() === 404 && m === 'GET' && /\/api\/projects\/\d+\/reviews$/.test(r.url()));
      if (!expected) errors.push(`${who}: ${m} ${r.url()} → ${r.status()}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who}: console error: ${m.text()}`);
    });
    await page.goto(BASE);
    await page.getByRole('button', { name: /^All comments/ }).click();
    await page.getByRole('heading', { name: 'All comments' }).waitFor();
    await page.locator('li.wb-row').filter({ has: page.locator('.wb-row-vp', { hasText: /^Tag View 1$/ }) }).click();
    const drawer = page.getByRole('region', { name: 'Comment details' });
    await drawer.getByRole('heading', { name: 'Tag View 1' }).waitFor();
    return { page, drawer, status: drawer.getByRole('group', { name: 'Status' }) };
  }
  const A = await open('Boss', boss);
  const B = await open('Rina', rina);
  const pressed = (side, label) => side.status.locator('button[aria-pressed="true"]', { hasText: label });
  step('Boss and Rina both opened "Tag View 1"');

  // ---- 1. resolution conflict ----
  const saved = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/records\/\d+$/.test(r.url()));
  let res = saved(A.page);
  await A.status.getByRole('button', { name: /In Review/ }).click();
  if ((await res).status() !== 200) fail('Boss could not save the status');
  await pressed(B, 'Open').waitFor(); // Rina still has the old copy
  step('Boss set "In Review"; Rina still sees "Open"');

  res = saved(B.page);
  await B.drawer.getByLabel('Resolution').fill("Rina's fix");
  if ((await res).status() !== 409) fail('Rina\'s stale save was not refused');
  await B.page.getByText(CONFLICT).waitFor();
  await pressed(B, 'In Review').waitFor();
  if ((await B.drawer.getByLabel('Resolution').inputValue()) !== "Rina's fix") fail('Rina\'s typed resolution was lost');
  step('Rina\'s save refused: she sees "In Review", her text is still in the field');

  res = saved(B.page);
  await B.page.getByRole('button', { name: 'Save mine' }).click();
  if ((await res).status() !== 200) fail('"Save mine" did not save');
  let srv = await boss.call('GET', `/api/records/${ids[0]}`);
  if (srv.resolution !== "Rina's fix" || srv.status !== 'In Review') fail(`server record after "Save mine": ${JSON.stringify(srv)}`);
  step('"Save mine" saved her resolution, Boss\'s status kept');

  // ---- 2. Boss sees it without reloading (timer refresh, ≤ 30 s) ----
  const t0 = Date.now();
  await A.page.waitForFunction(() => document.querySelector('[aria-label="Comment details"] textarea')?.value === "Rina's fix", null, { timeout: 40000 });
  step(`Boss's screen showed Rina's resolution after ${Math.round((Date.now() - t0) / 1000)} s, no reload`);

  // ---- 3. plain conflict on another field ----
  await boss.call('PATCH', `/api/records/${ids[0]}`, { discipline: 'STR' }); // behind Rina's back
  res = saved(B.page);
  await B.status.getByRole('button', { name: /Closed/ }).click();
  if ((await res).status() !== 409) fail('Rina\'s stale status change was not refused');
  await pressed(B, 'In Review').waitFor();
  srv = await boss.call('GET', `/api/records/${ids[0]}`);
  if (srv.status !== 'In Review' || srv.discipline !== 'STR') fail(`server record after the refused change: ${JSON.stringify(srv)}`);
  step('a stale status change was refused and the newer values shown');

  // ---- and a normal save still works afterwards ----
  res = saved(B.page);
  await B.status.getByRole('button', { name: /Closed/ }).click();
  if ((await res).status() !== 200) fail('Rina could not save after the conflict');
  srv = await boss.call('GET', `/api/records/${ids[0]}`);
  if (srv.status !== 'Closed' || !srv.closedAt) fail(`server record after closing: ${JSON.stringify(srv)}`);
  step('Rina closed it on the second try');

  // ---- 4. roles and shared data ----
  const count = async () => (await boss.call('GET', `/api/reviews/${review.id}/records`)).length;
  if (await B.drawer.getByRole('button', { name: 'Delete this comment' }).count()) fail('a reviewer sees Delete');
  if (!(await A.drawer.getByRole('button', { name: 'Delete this comment' }).count())) fail('the admin has no Delete');
  await A.drawer.getByText(/imported it from smoke\.html/).waitFor();
  step('the admin can delete and sees the history; the reviewer cannot delete');

  for (const side of [A, B]) await side.page.getByText('Target 31 Jan 2030').first().waitFor();
  if (await B.page.getByRole('button', { name: 'Import', exact: true }).count()) fail('a reviewer sees Import');
  step('both see the review target saved on the server; the reviewer has no Import');

  await A.page.getByRole('button', { name: 'Help' }).first().click();
  await A.page.getByRole('button', { name: 'About' }).click();
  await A.page.getByText('Shared on your office Tabelin server').waitFor();
  step('Help › About: shared on the office server');

  await A.page.getByRole('button', { name: 'Settings' }).first().click();
  await A.page.locator('input[type=file][accept=".xlsx"]').setInputFiles(path.join(ROOT, 'docs/3D REVIEW LOG_MASTER_FORMAL_90_OFA.xlsx'));
  for (let i = 0; ; i += 1) {
    const r = await fetch(`${BASE}/api/projects/${project.id}/template`, { headers: { Cookie: boss.cookie.join('=') } });
    if (r.ok) break;
    if (i > 50) fail('the template did not reach the server');
    await new Promise((x) => setTimeout(x, 100));
  }
  step('the admin uploaded the log-sheet template to the project');

  const sample = path.join(ROOT, 'src/sample');
  const files = ['report.html', ...fs.readdirSync(sample).filter((f) => f.endsWith('.jpg'))].map((f) => path.join(sample, f));
  await A.page.getByRole('button', { name: 'Work' }).first().click();
  await A.page.locator('input[type=file][accept*=".html"]').setInputFiles(files);
  await A.page.getByRole('button', { name: 'Update review' }).click();
  // none of the report's comment ids are in the review, so nothing matches
  await A.page.getByText(/^Imported 747 comments/).waitFor({ timeout: 60000 });
  if ((await count()) !== 750) fail(`after importing the sample: ${await count()} comments, expected 750`);
  await A.page.getByRole('button', { name: 'Undo' }).click();
  await A.page.getByText('Import undone.').waitFor({ timeout: 60000 });
  if ((await count()) !== 3) fail(`after Undo: ${await count()} comments, expected 3`);
  step('the admin imported the sample (750 comments) and undid it (3)');

  await A.page.getByRole('button', { name: 'Add', exact: true }).click();
  await A.page.getByPlaceholder('e.g. CPY_Dito: Provide access platform for the valve').fill('CPY_Dito: PIP to add a pipe support');
  await A.page.getByRole('dialog').getByRole('button', { name: 'Add comment' }).click();
  await A.page.getByText('Comment added.').waitFor();
  const all = await boss.call('GET', `/api/reviews/${review.id}/records`);
  const manual = all.find((r) => r.source === 'manual');
  if (all.length !== 4 || !manual || manual.commentText !== 'PIP to add a pipe support') fail(`after adding: ${JSON.stringify(all.map((r) => [r.id, r.source]))}`);
  step('the admin added a comment by hand (saved on the server)');

  // ---- 5. Trash: delete → Undo; delete → restore from the Trash; delete → delete for good ----
  const del = async () => {
    await A.drawer.getByRole('button', { name: 'Delete this comment' }).click();
    await A.page.getByRole('dialog').getByRole('button', { name: 'Move to Trash' }).click();
    await A.page.getByText('Comment moved to the Trash.').waitFor();
  };
  await del();
  if ((await count()) !== 3) fail(`after moving to the Trash: ${await count()} comments, expected 3`);
  await A.page.getByRole('button', { name: 'Undo' }).click();
  await A.page.getByText('Comment restored.').waitFor();
  await A.drawer.getByRole('heading', { name: 'Manual' }).waitFor();
  if ((await count()) !== 4) fail(`after Undo: ${await count()} comments, expected 4`);
  step('deleting a comment moves it to the Trash; Undo brings it straight back');

  await del();
  if (await B.page.getByRole('button', { name: 'Trash' }).count()) fail('a reviewer sees the Trash');
  await A.page.getByRole('button', { name: 'Trash' }).first().click();
  const trashRow = A.page.getByRole('row').filter({ hasText: 'PIP to add a pipe support' });
  await trashRow.waitFor();
  await trashRow.getByRole('button', { name: 'Restore' }).click();
  await A.page.getByText('Restored 1 comment.').waitFor();
  await A.page.getByText('The Trash is empty').waitFor();
  if ((await count()) !== 4) fail(`after restoring from the Trash: ${await count()} comments, expected 4`);
  step('the Trash (admins only) lists it; Restore puts it back');

  await A.page.getByRole('button', { name: 'Work' }).first().click();
  await A.page.getByRole('button', { name: /^All comments/ }).click();
  await A.page.locator('li.wb-row').filter({ has: A.page.locator('.wb-row-vp', { hasText: /^Manual$/ }) }).click();
  await del();
  await A.page.getByRole('button', { name: 'Trash' }).first().click();
  await A.page.getByRole('row').filter({ hasText: 'PIP to add a pipe support' }).getByRole('button', { name: 'Delete for good' }).click();
  await A.page.getByRole('dialog').getByRole('button', { name: 'Delete for good' }).click();
  await A.page.getByText('Deleted 1 comment for good.').waitFor();
  const trash = await boss.call('GET', '/api/trash');
  if (trash.records.length || (await count()) !== 3) fail(`after deleting for good: trash ${trash.records.length}, comments ${await count()}`);
  step('Delete for good empties it from the Trash');

  // ---- 6. backup ----
  await A.page.getByRole('button', { name: 'Settings' }).first().click();
  await A.page.getByRole('button', { name: 'Backup' }).first().click();
  const [download] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('link', { name: 'Download backup' }).click()]);
  const zipPath = path.join(tmp, 'backup.zip');
  await download.saveAs(zipPath);
  const head = fs.readFileSync(zipPath).subarray(0, 2).toString();
  if (head !== 'PK' || !/^tabelin-backup-.*\.zip$/.test(download.suggestedFilename())) fail(`backup download: ${download.suggestedFilename()} ${head}`);
  step(`Settings › Backup downloads ${download.suggestedFilename()} (${Math.round(fs.statSync(zipPath).size / 1024)} KB)`);

  // ---- 7. who can open the project ----
  await A.page.getByRole('button', { name: /Smoke project/ }).first().click(); // the review chip → switch review
  await A.page.getByRole('button', { name: 'All projects' }).click();
  await A.page.getByRole('button', { name: 'More for Smoke project' }).click();
  await A.page.getByRole('menuitem', { name: 'Who can open…' }).click();
  await A.page.getByRole('radio', { name: /Only these people/ }).check();
  await A.page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await A.page.getByText('0 people').waitFor();
  await B.page.reload();
  await B.page.getByText(/No projects yet/).waitFor();
  step('"Who can open…" → only chosen people: the reviewer no longer sees the project');
  await A.page.getByRole('button', { name: 'More for Smoke project' }).click();
  await A.page.getByRole('menuitem', { name: 'Who can open…' }).click();
  await A.page.getByRole('radio', { name: /Only these people/ }).check();
  await A.page.getByRole('dialog').getByRole('checkbox', { name: /Rina/ }).check();
  await A.page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await A.page.getByText('1 person').waitFor();
  await B.page.reload();
  await B.page.getByRole('button', { name: /^All comments/ }).waitFor();
  step('ticking her gives her the project back (she lands in the review again)');

  if (errors.length) fail(`the page reported errors:\n${errors.join('\n')}`);
  console.log('\nSERVER SMOKE OK');
} catch (e) {
  console.error(`\nSERVER SMOKE FAILED: ${e.message}`);
  if (errors.length && !e.message.includes('reported errors')) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
