import { expect, test } from '../dist/index.js';
import { openApp, taps } from './helpers.js';

test.describe('at device pixel ratio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('clicks land on the object', async ({ page, pixi }) => {
    await openApp(page, '?density=1');
    expect(await page.evaluate(() => document.querySelector('canvas')?.width)).toBe(1600);
    await pixi.getByLabel('settings').click();
    expect(await taps(page)).toEqual(['settings']);
  });

  test('bounding boxes stay in CSS pixels', async ({ page, pixi }) => {
    await openApp(page, '?density=1');
    expect(await pixi.getByLabel('settings').boundingBox()).toEqual({ x: 20, y: 70, width: 120, height: 40 });
  });
});

test('clicks land on the object when CSS scales the canvas down', async ({ page, pixi }) => {
  await openApp(page, '?cssScale=0.5');
  await pixi.getByLabel('settings').click();
  expect(await taps(page)).toEqual(['settings']);
  expect(await pixi.getByLabel('settings').boundingBox()).toEqual({ x: 10, y: 35, width: 60, height: 20 });
});

test('clicks land on the object when CSS scales the canvas up at high density', async ({ page, pixi }) => {
  await openApp(page, '?density=1&cssScale=1.1&offsetX=25');
  await pixi.getByLabel('badged').click();
  expect(await taps(page)).toEqual(['badged']);
});

test('the page scrolls a target below the fold into view', async ({ page, pixi }) => {
  await openApp(page, '?spacer=1500');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await pixi.getByLabel('settings').click();
  expect(await taps(page)).toEqual(['settings']);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('clicks land on the object when the page is already scrolled', async ({ page, pixi }) => {
  await openApp(page, '?spacer=300');
  await page.evaluate(() => window.scrollTo(0, 250));
  await pixi.getByLabel('settings').click();
  expect(await taps(page)).toEqual(['settings']);
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);
  const box = await pixi.getByLabel('settings').boundingBox();
  expect(box?.y).toBe(300 + 70 - scrolled);
});
