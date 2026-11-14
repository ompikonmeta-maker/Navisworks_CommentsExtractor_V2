// Re-capture the Help screenshots that show the Work screen (overview, list,
// drawer, bulk) from the offline build with the bundled sample. Run after a
// change to the Work screen:  npm run build && node scripts/help-shots.mjs
// Needs Python with Pillow for the WebP conversion. The dialog shots (add,
// export, reimport, picker) are taken by hand.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tabelin-shots-'));
const executablePath = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium'].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + ROOT + '/dist/index.html');
await page.locator('li.wb-row').first().waitFor();
// a target ~30 days out and three close-outs, so the headline has something to say
const t = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
await page.getByRole('button', { name: /Set a target/ }).click();
await page.locator('#ov-target').fill(t);
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.getByText(/Target \d/).first().waitFor();
await page.getByRole('button', { name: /^All comments/ }).click();
const detail = page.getByRole('region', { name: 'Comment details' });
for (let i = 3; i < 6; i += 1) {
  await page.locator('li.wb-row').nth(i).click();
  await detail.getByRole('group', { name: 'Status' }).getByRole('button', { name: /Closed/ }).click();
  await page.waitForTimeout(600);
}
await page.getByRole('button', { name: /Give a discipline/ }).click();
await page.locator('li.wb-row').first().click();
await page.mouse.move(5, 5);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${TMP}/overview.png` });
const box = async (sel) => page.locator(sel).first().boundingBox();
const q = await box('nav[aria-label="Queues"]');
const l = await box('section[aria-label="Comments in this queue"]');
await page.screenshot({ path: `${TMP}/list.png`, clip: { x: q.x - 8, y: q.y - 8, width: l.x + l.width - q.x + 16, height: Math.min(560, l.height + 16) } });
const d = await box('section[aria-label="Comment details"]');
await page.screenshot({ path: `${TMP}/drawer.png`, clip: { x: d.x - 8, y: d.y - 8, width: d.width + 16, height: d.height + 16 } });
// bulk: tick three rows
const boxes = page.locator('li.wb-row input[type=checkbox]');
for (let i = 0; i < 3; i += 1) await boxes.nth(i).check();
await page.waitForTimeout(500);
const bar = await box('.t-bulk');
const x0 = Math.min(l.x, bar.x) - 8;
const x1 = Math.max(l.x + l.width, bar.x + bar.width) + 8;
const y0 = Math.max(l.y - 8, bar.y - 520);
await page.screenshot({ path: `${TMP}/bulk.png`, clip: { x: x0, y: y0, width: x1 - x0, height: bar.y + bar.height + 16 - y0 } });
await browser.close();
// → webp at the old widths
for (const [name, w] of [['overview', 1100], ['list', 1100], ['drawer', 700], ['bulk', 1100]]) {
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${TMP}/${name}.png'); r=${w}/im.width; im=im.resize((${w}, round(im.height*r)), Image.LANCZOS); im.save('${ROOT}/src/assets/help/${name}.webp', 'WEBP', quality=82, method=6); print('${name}', im.size)`], { stdio: 'inherit' });
}
fs.rmSync(TMP, { recursive: true, force: true });
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exitCode = 1; } else console.log('Help screenshots updated in src/assets/help/');
