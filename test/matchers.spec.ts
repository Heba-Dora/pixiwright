import { expect, test } from '../dist/index.js';
import { openApp, openBlank } from './helpers.js';

test.describe('in the fixture app', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('toBeVisible tells drawn objects from hidden ones', async ({ pixi }) => {
    await expect(pixi.getByLabel('play')).toBeVisible();
    await expect(pixi.getByLabel('dimmed-child')).toBeVisible();
    for (const label of ['ghost', 'invisible', 'faded-child', 'outside', 'offscreen', 'nothing-here']) {
      await expect(pixi.getByLabel(label)).not.toBeVisible();
    }
  });

  test('toBeVisible explains a failure', async ({ pixi }) => {
    await expect(expect(pixi.getByLabel('ghost')).toBeVisible({ timeout: 100 })).rejects.toThrow(/Received: hidden: "ghost" has alpha = 0/);
  });

  test('toBeVisible retries until the object changes', async ({ pixi }) => {
    await expect(pixi.getByLabel('swap-target')).toBeVisible();
    await pixi.getByLabel('swap').click();
    await expect(pixi.getByLabel('swap-target')).not.toBeVisible();
  });

  test('toHaveText retries until the text changes', async ({ pixi }) => {
    await expect(pixi.getByLabel('status')).toHaveText('Waiting');
    await pixi.getByLabel('swap').click();
    await expect(pixi.getByLabel('status')).toHaveText('Ready');
    await expect(pixi.getByLabel('status')).toHaveText(/^Rea/);
    await expect(pixi.getByLabel('status')).not.toHaveText('Waiting');
  });

  test('toHaveText reads text from descendants', async ({ pixi }) => {
    await expect(pixi.getByLabel('play')).toHaveText('Play');
    expect(await pixi.getByLabel('play').textContent()).toBe('Play');
  });

  test('getByText matches loosely by default and exactly on request', async ({ pixi }) => {
    await expect(pixi.getByText('play')).toHaveCount(1);
    await expect(pixi.getByText('play', { exact: true })).toHaveCount(0);
    await expect(pixi.getByText(/^Pl/)).toHaveCount(1);
  });

  test('toHaveCount retries until the count changes', async ({ pixi }) => {
    await expect(pixi.getByLabel('twin')).toHaveCount(2);
    await expect(pixi.getByLabel('late')).toHaveCount(1);
    await expect(pixi.getByLabel('nothing-here')).toHaveCount(0);
  });

  test('toMatchScene retries and compares structure with a stored file', async ({ pixi }) => {
    await pixi.getByLabel('swap').click();
    await expect(pixi).toMatchScene('after-swap.txt', { bounds: false, timeout: 3000, labels: /^(status|swap-target|swap)$/ });
  });

  test('scene lists labeled objects with their state', async ({ pixi }) => {
    const scene = await pixi.scene();
    expect(scene).toContain('- Container "menu"');
    expect(scene).toContain('  - Graphics "play" [20, 20, 120, 40]');
    expect(scene).toContain('- Graphics "ghost" (hidden: "ghost" has alpha = 0)');
    expect(scene).toContain('alpha=0.5');
    expect(scene).not.toContain('Graphics "Graphics"');
  });
});

test('matchers imported from pixiwright still work on DOM locators', async ({ page }) => {
  await openBlank(page);
  await expect(page.locator('#plain')).toBeVisible();
  await expect(page.locator('#plain')).toHaveText('Plain button');
  await expect(page.locator('#plain')).toHaveCount(1);
  await expect(page.locator('#missing')).not.toBeVisible();
  await expect(expect(page.locator('#missing')).toBeVisible({ timeout: 100 })).rejects.toThrow(/toBeVisible/);
});
