// Loads the live site once, then again with the network off, at three widths.
import puppeteer from 'puppeteer-core';
const url = process.argv[2] ?? 'https://swchyd.github.io/steadfast/';
const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle0' });
await page.evaluate(() => navigator.serviceWorker.ready);
await new Promise((r) => setTimeout(r, 1500));
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'load' });
console.log('offline title:', await page.$eval('h1', (n) => n.textContent));
for (const width of [360, 768, 1440]) {
  await page.setViewport({ width, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const small = await page.evaluate(() => [...document.querySelectorAll('button:not([hidden])')].filter((b) => b.offsetHeight && b.offsetHeight < 48).length);
  console.log(width, 'px: sideways scroll =', overflow, '| buttons under 48px =', small);
}
await browser.close();
