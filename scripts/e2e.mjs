// Drives the built app in a real browser with a video file standing in for the camera.
// Usage: node scripts/e2e.mjs <exercise> <seconds> [video.mjpeg] [url]
import puppeteer from 'puppeteer-core';

const [exercise = 'pushup', seconds = '20', videoFile = '', url = 'http://localhost:4173/'] = process.argv.slice(2);
const label = { pushup: 'Push-ups', squat: 'Squats', plank: 'Plank' }[exercise];

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-gpu', '--use-angle=default'];
if (videoFile) args.push(`--use-file-for-fake-video-capture=${videoFile}`);
const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: process.env.HEADFUL ? false : 'new',
  args,
});
const page = await browser.newPage();
await page.setViewport({ width: 360, height: 760 });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
await page.goto(url, { waitUntil: 'networkidle0' });

const clickText = (text) =>
  page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent === t).click(), text);
await clickText(label);
await clickText('Start camera');
await page.waitForFunction(() => document.querySelector('.meta')?.textContent, { timeout: 60000 });

const hud = () =>
  page.evaluate(() => ({
    count: document.querySelector('.count strong').textContent,
    hint: document.querySelector('.hint').textContent,
    meta: document.querySelector('.meta').textContent,
    camOpen: !document.querySelector('.cam').hidden,
  }));
const t0 = Date.now();
let lastLine = '';
while (Date.now() - t0 < Number(seconds) * 1000) {
  const h = await hud();
  if (!h.camOpen) break;
  const line = `${h.count} | ${h.hint} | ${h.meta}`;
  if (process.env.VERBOSE || line.split('|').slice(0, 2).join() !== lastLine.split('|').slice(0, 2).join()) console.log(line);
  lastLine = line;
  await new Promise((r) => setTimeout(r, 250));
}
if ((await hud()).camOpen) await clickText('Stop');
await new Promise((r) => setTimeout(r, 500));
const end = await page.evaluate(() => ({
  summary: [...document.querySelectorAll('section:not([hidden]) dl')][0]?.innerText,
  notice: document.querySelector('.notice:not([hidden])')?.textContent ?? null,
  cameraReleased: document.querySelector('video').srcObject === null,
  device: [...document.querySelectorAll('section dl')].pop()?.innerText,
}));
console.log(JSON.stringify(end, null, 1));
if (problems.length) console.log('PROBLEMS', problems);
await browser.close();
