// Server smoke test: two people on the office server edit the same comment.
//   1. Boss (admin) changes the status; Rina (reviewer) still has the old copy
//      and types a resolution → her save is refused, she sees Boss's status,
//      her text stays in the field, and "Save mine" saves it.
//   2. Boss sees Rina's resolution appear by itself (the 30-second refresh).
//   3. A plain conflict (no resolution) just shows the newer values.
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
  step('project, review with 3 comments, and a reviewer created');

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
    // Failed requests are checked one by one; two are expected: a refused
    // save (409) and the setup checklist asking whether a template exists yet
    // (HEAD …/template → 404). The browser also logs every failed request as a
    // console error, so those lines are left to this check.
    page.on('response', (r) => {
      if (r.status() < 400) return;
      const m = r.request().method();
      const expected = (r.status() === 409 && m === 'PATCH') || (r.status() === 404 && m === 'HEAD' && /\/template$/.test(r.url()));
      if (!expected) errors.push(`${who}: ${m} ${r.url()} → ${r.status()}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who}: console error: ${m.text()}`);
    });
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Viewpoints' }).first().click();
    await page.locator('tr.vp-row').first().waitFor();
    await page.locator('tr.vp-row', { hasText: 'Tag View 1' }).click();
    const drawer = page.getByRole('dialog', { name: 'Viewpoint detail' });
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
  await A.page.waitForFunction(() => document.querySelector('[aria-label="Viewpoint detail"] textarea')?.value === "Rina's fix", null, { timeout: 40000 });
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
