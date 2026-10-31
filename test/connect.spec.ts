import { test as plainTest } from '@playwright/test';
import { connectPixi, expect, test } from '../dist/index.js';
import { openApp, openBlank, taps } from './helpers.js';

test('connects through PixiJS\'s startup hook with no help from the app', async ({ page, pixi }) => {
  await openApp(page);
  await pixi.requireApp();
  expect(await page.evaluate(() => '__PIXI_DEVTOOLS__' in globalThis)).toBe(false);
});

plainTest('a page connected too late explains what to do', async ({ page }) => {
  await openApp(page);
  const pixi = await connectPixi(page, { timeout: 200 });
  await expect(pixi.getByLabel('play').click()).rejects.toThrow(/no PixiJS application was found/);
});

plainTest('a page connected late can use the devtools global', async ({ page }) => {
  await openApp(page, '?devtools=1');
  await page.waitForFunction(() => (window as unknown as { fixtureReady?: boolean }).fixtureReady);
  const pixi = await connectPixi(page);
  await pixi.getByLabel('play').click();
  await expect(pixi.getByLabel('score')).toHaveText('Score: 1');
});

plainTest('a page with no PixiJS fails clearly', async ({ page }) => {
  await openBlank(page);
  const pixi = await connectPixi(page, { timeout: 200 });
  await expect(pixi.scene()).rejects.toThrow(/no PixiJS application was found/);
});

test('reconnects after a navigation', async ({ page, pixi }) => {
  await openApp(page);
  await pixi.getByLabel('play').click();
  await expect(pixi.getByLabel('score')).toHaveText('Score: 1');
  await page.reload();
  await expect(pixi.getByLabel('score')).toHaveText('Score: 0');
});

test('works against the minified production build of PixiJS', async ({ page, pixi }) => {
  await openApp(page, '', { minified: true });
  await pixi.getByLabel('play').click();
  await expect(pixi.getByLabel('score')).toHaveText('Score: 1');
  expect(await pixi.scene()).toContain('Graphics "play"');
  expect(await pixi.scene()).toContain('Text "score"');
});

test('connectPixi chooses between several apps on a page', async ({ page, pixi }) => {
  await openApp(page, '?second=1');
  const second = await connectPixi(page, { appIndex: 1 });
  await expect(second.getByLabel('second-button')).toBeVisible();
  await expect(pixi.getByLabel('second-button')).toHaveCount(0);
  await second.getByLabel('second-button').click();
  expect(await taps(page)).toEqual(['second-button']);
});

test('destroyed apps are forgotten', async ({ page, pixi }) => {
  await openApp(page, '?second=1');
  await expect(pixi.getByLabel('play')).toBeVisible();
  await page.evaluate(() => (window as unknown as { destroyApp(): void }).destroyApp());
  await expect(pixi.getByLabel('second-button')).toHaveCount(1);
});

test('the app runs on the WebGPU renderer when the browser offers one', async ({ page, pixi }) => {
  await openApp(page, '?renderer=webgpu');
  await page.waitForFunction(() => (window as unknown as { fixtureReady?: boolean }).fixtureReady);
  const renderer = await page.evaluate(() => (window as unknown as { rendererName: string }).rendererName);
  test.skip(renderer !== 'webgpu', 'this browser has no WebGPU adapter');
  await pixi.getByLabel('play').click();
  await expect(pixi.getByLabel('score')).toHaveText('Score: 1');
  const image = await pixi.canvasImage();
  expect(image.length).toBeGreaterThan(1000);
});
