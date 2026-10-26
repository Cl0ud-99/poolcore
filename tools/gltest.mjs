import { chromium } from 'playwright-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const variants = [
  { name: 'default', args: ['--no-sandbox'] },
  { name: 'angle-d3d11', args: ['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu-rasterization'] },
  { name: 'angle-gl', args: ['--no-sandbox','--use-angle=gl','--ignore-gpu-blocklist'] },
];
for (const v of variants) {
  try {
    const b = await chromium.launch({ executablePath: CHROME, args: v.args });
    const p = await b.newPage();
    await p.goto('http://127.0.0.1:5273/', { waitUntil: 'domcontentloaded' });
    const caps = await p.evaluate(() => window.__CAPS__ ? window.__CAPS__.renderer : 'none').catch(e => 'err ' + e.message);
    const ms = await p.evaluate(() => window.__RENDERMS__ || 0).catch(()=>0);
    console.log(v.name, '=>', caps, 'ms', ms);
    await b.close();
  } catch (e) { console.log(v.name, 'FAIL', e.message.slice(0,200)); }
}
