import { expect, test } from '../dist/index.js';
import { openApp } from './helpers.js';

test.describe('starting frozen', () => {
  test.use({ pixiClock: 'frozen' });

  test('no frame runs until a step', async ({ page, pixi }) => {
    await openApp(page);
    await page.waitForTimeout(150);
    await expect(pixi.getByLabel('frames')).toHaveText('Frames: 0');
    await pixi.clock.step(3);
    await expect(pixi.getByLabel('frames')).toHaveText('Frames: 3');
  });

  test('steps advance by exact frame durations', async ({ page, pixi }) => {
    await openApp(page);
    await pixi.clock.step(60);
    const box = await pixi.getByLabel('runner').boundingBox();
    expect(box?.x).toBeCloseTo(240, 5);
  });

  test('steps follow the requested frame rate', async ({ page, pixi }) => {
    await openApp(page);
    await pixi.clock.step(10, { fps: 30 });
    const box = await pixi.getByLabel('runner').boundingBox();
    expect(box?.x).toBeCloseTo(20 + (10 / 30) * 1000 * 0.45, 5);
  });

  test('an app on the shared ticker freezes and steps too', async ({ page, pixi }) => {
    await openApp(page, '?sharedTicker=1');
    await page.waitForTimeout(100);
    await expect(pixi.getByLabel('frames')).toHaveText('Frames: 0');
    await pixi.clock.step(3);
    await expect(pixi.getByLabel('frames')).toHaveText('Frames: 3');
  });

  test('the same steps give the same scene and the same pixels on every load', async ({ page, pixi }) => {
    const capture = async () => {
      // The fixture's setTimeout runs on real time, which a frozen ticker does not control.
      await openApp(page, '?noTimers=1');
      await pixi.clock.step(37);
      return { scene: await pixi.scene({ all: true }), image: await pixi.canvasImage() };
    };
    const first = await capture();
    const second = await capture();
    expect(second.scene).toBe(first.scene);
    expect(second.image.equals(first.image)).toBe(true);
  });

  test('the app cannot restart the clock on its own', async ({ page, pixi }) => {
    await openApp(page);
    await page.evaluate(() => (window as unknown as { callAppStart(): void }).callAppStart());
    await page.waitForTimeout(100);
    await expect(pixi.getByLabel('frames')).toHaveText('Frames: 0');
  });

  test('clicks work on a frozen scene that has not advanced', async ({ page, pixi }) => {
    await openApp(page);
    await pixi.getByLabel('play').click();
    await expect(pixi.getByLabel('score')).toHaveText('Score: 1');
  });

  test('resume starts the clock again', async ({ page, pixi }) => {
    await openApp(page);
    expect(await pixi.clock.isFrozen()).toBe(true);
    await pixi.clock.resume();
    expect(await pixi.clock.isFrozen()).toBe(false);
    await expect(pixi.getByLabel('frames')).not.toHaveText('Frames: 0');
  });
});

test('a running clock can be frozen partway through', async ({ page, pixi }) => {
  await openApp(page);
  await expect(pixi.getByLabel('frames')).not.toHaveText('Frames: 0');
  await pixi.clock.freeze();
  const before = await pixi.getByLabel('frames').textContent();
  await page.waitForTimeout(100);
  expect(await pixi.getByLabel('frames').textContent()).toBe(before);
  await pixi.clock.step(2);
  expect(await pixi.getByLabel('frames').textContent()).not.toBe(before);
});

test('stepping a running clock is refused', async ({ page, pixi }) => {
  await openApp(page);
  await expect(pixi.clock.step()).rejects.toThrow(/freeze the clock before stepping it/);
});
