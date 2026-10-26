import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];

const W = Number(opt.w || 1280), H = Number(opt.h || 720);
const QS = opt.q || 'high';
const SHOTS = (opt.shots || opt.shot || 'hero').split(',').map(s => s.trim()).filter(Boolean);
const OUTDIR = opt.dir || 'shots';
const PREFIX = opt.prefix || '';
const WAIT = Number(opt.wait || 1200);
const SCALE = opt.scale || '';

fs.mkdirSync(OUTDIR, { recursive: true });

const EXTRA = opt.qs ? ('&' + opt.qs) : '';
const base = opt.url || ('http://127.0.0.1:5273/?q=' + QS + (SCALE ? '&scale=' + SCALE : '') + EXTRA);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--ignore-gpu-blocklist',
         '--enable-webgl', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--js-flags=--max-old-space-size=4096'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + (e && e.message)));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

const t0 = Date.now();
await page.goto(base + '&shot=' + SHOTS[0], { waitUntil: 'domcontentloaded', timeout: 180000 });
try {
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000 });
} catch (e) {
  errors.push('TIMEOUT waiting ready');
  const st = await page.evaluate(() => window.__BOOT__ || 'no-boot-state').catch(() => 'eval-fail');
  errors.push('BOOT ' + JSON.stringify(st));
}
const tReady = Date.now() - t0;
const results = [];
for (const s of SHOTS) {
  await page.evaluate((n) => { if (window.__APP__ && window.__APP__.setShot) window.__APP__.setShot(n); }, s);
  await page.waitForTimeout(WAIT);
  const out = path.join(OUTDIR, PREFIX + s + '.png');
  await page.screenshot({ path: out });
  results.push(out);
}
const perf = await page.evaluate(() => (window.__APP__ && window.__APP__.stats) ? window.__APP__.stats() : null).catch(() => null);
console.log(JSON.stringify({ shots: results, readyMs: tReady, perf, errors: errors.slice(0, 12) }, null, 1));
await browser.close();
