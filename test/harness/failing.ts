// Run by report.spec.ts in a child Playwright. Some of these fail on purpose.
import { expect, test } from '../../dist/index.js';
import { openApp } from '../helpers.js';

test('fails on purpose', async ({ page, pixi }) => {
  await openApp(page);
  await pixi.getByLabel('ghost').click({ timeout: 200 });
});

test('passes', async ({ page, pixi }) => {
  await openApp(page);
  await pixi.getByLabel('play').click();
});

test('scene snapshot', async ({ page, pixi }) => {
  await openApp(page);
  await expect(pixi).toMatchScene('score.txt', { bounds: false, labels: /^score$/ });
});

test('changed scene', async ({ page, pixi }) => {
  await openApp(page);
  await pixi.getByLabel('play').click();
  await expect(pixi).toMatchScene('score.txt', { bounds: false, labels: /^score$/, timeout: 200 });
});
