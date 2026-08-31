import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-webgl', '--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', error => consoleErrors.push(error.message));
page.on('response', response => { if (response.status() >= 400) consoleErrors.push(`${response.status()} ${response.url()}`); });
page.on('requestfailed', request => consoleErrors.push(`FAILED ${request.url()} ${request.failure()?.errorText}`));

await page.goto('http://127.0.0.1:3201', { waitUntil: 'domcontentloaded', timeout: 30000 });
try {
  await page.locator('.map canvas').waitFor({ state: 'visible', timeout: 30000 });
} catch (error) {
  console.error(JSON.stringify({ consoleErrors, body: (await page.locator('body').innerText()).slice(0, 2000), html: (await page.content()).slice(0, 1000) }, null, 2));
  throw error;
}
await page.waitForTimeout(3000);
const canvas = page.locator('.map canvas');
const box = await canvas.boundingBox();
if (!box) throw new Error('Map canvas has no box');
await canvas.click({ position: { x: Math.min(600, box.width * .48), y: Math.min(470, box.height * .52) } });
await page.getByText(/분석 지점 ·/).waitFor({ timeout: 10000 });
await page.getByRole('button', { name: '직사광 추정 리포트 만들기' }).click();
try {
  await page.locator('.report-card').waitFor({ timeout: 30000 });
} catch (error) {
  console.error(JSON.stringify({ consoleErrors, analysisText: await page.locator('.analysis-panel').innerText(), apiResponses: 'see consoleErrors' }, null, 2));
  throw error;
}
const desktop = await page.evaluate(() => {
  const panel = document.querySelector('.analysis-panel');
  const report = document.querySelector('.report-card');
  const map = document.querySelector('.map');
  const root = document.documentElement;
  const panelRect = panel?.getBoundingClientRect();
  return {
    viewport: [innerWidth, innerHeight],
    documentOverflowX: root.scrollWidth - root.clientWidth,
    panel: panelRect && { top: panelRect.top, bottom: panelRect.bottom, width: panelRect.width, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight },
    reportText: report?.textContent?.slice(0, 500),
    buildingSource: map?.getAttribute('data-building-source'),
    buildingCount: map?.getAttribute('data-building-count'),
    shadowButtonDisabled: document.querySelector('.analysis-actions button:nth-child(2)')?.disabled,
  };
});
await page.getByRole('button', { name: '후보에 추가' }).click();
const candidateCount = await page.locator('.comparison-list article').count();
await page.getByRole('button', { name: '누적 그림자 보기' }).click();
const overlayVisible = await page.evaluate(() => document.querySelector('.analysis-actions button:nth-child(2)')?.textContent?.includes('끄기'));
await page.screenshot({ path: '/tmp/sun-map-desktop.png', fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto('http://127.0.0.1:3201', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
const mobile = await page.evaluate(() => {
  const panel = document.querySelector('.analysis-panel');
  const timeline = document.querySelector('.timeline');
  const panelRect = panel?.getBoundingClientRect();
  const timelineRect = timeline?.getBoundingClientRect();
  return {
    viewport: [innerWidth, innerHeight],
    documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    panel: panelRect && { top: panelRect.top, bottom: panelRect.bottom, width: panelRect.width, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight },
    timeline: timelineRect && { top: timelineRect.top, bottom: timelineRect.bottom },
    topbarHeight: document.querySelector('.topbar')?.getBoundingClientRect().height,
    submitHeight: document.querySelector('.point-setup button[type=submit]')?.getBoundingClientRect().height,
  };
});
await page.screenshot({ path: '/tmp/sun-map-mobile.png', fullPage: true });

const result = { desktop, candidateCount, overlayVisible, mobile, consoleErrors };
fs.writeFileSync('/tmp/sun-map-qa.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
