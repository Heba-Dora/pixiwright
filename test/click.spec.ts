import { expect, test } from '../dist/index.js';
import { openApp, taps } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('click fires the unmodified app\'s own handler through real input', async ({ page, pixi }) => {
  await pixi.getByLabel('play').click();
  expect(await taps(page)).toEqual(['play']);
  await expect(pixi.getByLabel('score')).toHaveText('Score: 1');
});

test('clicking a child reaches the interactive parent', async ({ page, pixi }) => {
  await pixi.getByText('Play').click();
  expect(await taps(page)).toEqual(['play']);
});

test('locators scope to a parent and pick by position', async ({ page, pixi }) => {
  await pixi.getByLabel('menu').getByLabel('settings').click();
  await pixi.getByLabel('twin').last().click();
  expect(await taps(page)).toEqual(['settings', 'twin']);
});

test('click waits for an object that appears late', async ({ page, pixi }) => {
  await pixi.getByLabel('late').click();
  expect(await taps(page)).toEqual(['late']);
});

test('click waits for a moving object to stop', async ({ page, pixi }) => {
  await pixi.getByLabel('runner').click({ timeout: 15_000 });
  expect(await taps(page)).toEqual(['runner']);
});

test('click holds off until a fast mover settles', async ({ page, pixi }) => {
  await page.evaluate(() => (window as unknown as { launchDart(): void }).launchDart());
  // The held press spans frames, so pressing while it still moves would release over empty canvas.
  await pixi.getByLabel('dart').click({ delay: 50, timeout: 15_000 });
  expect(await taps(page)).toEqual(['dart']);
});

test('click counts real frames on a page that renders slowly', async ({ page, pixi }) => {
  await page.evaluate(() => {
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => window.setTimeout(() => frame(callback), 150);
    (window as unknown as { launchDart(): void }).launchDart();
  });
  await pixi.getByLabel('dart').click({ delay: 200, timeout: 15_000 });
  expect(await taps(page)).toEqual(['dart']);
});

test('click does not wait out its timeout on a page that stops rendering', async ({ page, pixi }) => {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await pixi.getByLabel('settings').click();
  expect(await taps(page)).toEqual(['settings']);
});

test('a target that pulses around its center can still be clicked', async ({ page, pixi }) => {
  await pixi.getByLabel('pulse').click();
  expect(await taps(page)).toEqual(['pulse']);
});

test('several matches fail at once instead of guessing', async ({ pixi }) => {
  await expect(pixi.getByLabel('twin').click({ timeout: 30_000 })).rejects.toThrow(/strict mode violation: 2 objects match: "twin", "twin"/);
});

const refusals: [string, string, RegExp][] = [
  ['its own alpha is 0', 'ghost', /"ghost" has alpha = 0/],
  ['its own visible flag is off', 'invisible', /"invisible" has visible = false/],
  ['a parent has alpha 0', 'faded-child', /"faded-child"'s ancestor "faded" has alpha = 0/],
  ['its renderable flag is off', 'unrendered', /"unrendered" has renderable = false/],
  ['another interactive object is on top', 'under', /"under" is covered by "lid", which would receive the input at \(360, 40\)/],
  ['a non-interactive object is drawn over all of it', 'curtained', /"curtained" is covered by "curtain", which is drawn over it but takes no pointer events/],
  ['a parent\'s mask cuts it out', 'outside', /"outside" is masked out by "viewport"'s mask/],
  ['its own mask cuts it out', 'self-masked', /"self-masked" is masked out by its own mask/],
  ['it is off the canvas', 'offscreen', /"offscreen" is outside the 800×600 canvas, at \(900, 20\)/],
  ['it takes no pointer events', 'plain', /"plain" would not receive the input: nothing interactive is at \(80, 320\), and its eventMode is "passive"/],
  ['it does not exist', 'nothing-here', /no matching object in the scene/],
];

for (const [reason, label, message] of refusals) {
  test(`click refuses when ${reason}`, async ({ page, pixi }) => {
    await expect(pixi.getByLabel(label).click({ timeout: 300 })).rejects.toThrow(message);
    expect(await taps(page)).toEqual([]);
  });
}

test('click refuses when an HTML element sits over the canvas', async ({ page, pixi }) => {
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'dialog';
    overlay.style.cssText = 'position:fixed;inset:0;background:#0008';
    document.body.append(overlay);
  });
  await expect(pixi.getByLabel('play').click({ timeout: 300 })).rejects.toThrow(/"play" is under <div#dialog> in the page/);
  expect(await taps(page)).toEqual([]);
});

test('objects drawn on a target do not count as covering it', async ({ page, pixi }) => {
  await pixi.getByLabel('badged').click();
  await pixi.getByLabel('decorated').click();
  await pixi.getByLabel('dimmed-child').click();
  expect(await taps(page)).toEqual(['badged', 'decorated', 'dimmed-child']);
});

test('a partly masked object is clicked in its visible part', async ({ page, pixi }) => {
  await pixi.getByLabel('inside').click();
  expect(await taps(page)).toEqual(['inside']);
});

test('an object half off the canvas is clicked in the part on the canvas', async ({ page, pixi }) => {
  await pixi.getByLabel('edge').click();
  expect(await taps(page)).toEqual(['edge']);
});

test('a click an interactive parent would take is refused for an interactive child', async ({ page, pixi }) => {
  const child = pixi.getByLabel('corner-only');
  await expect(child.click({ timeout: 300 })).rejects.toThrow(/"corner-only" is covered by "panel", which would receive the input/);
  expect(await taps(page)).toEqual([]);
  await child.click({ position: { x: 5, y: 5 } });
  expect(await taps(page)).toEqual(['corner-only', 'panel']);
});

test('force skips the checks and sends the input anyway', async ({ page, pixi }) => {
  await pixi.getByLabel('curtained').click({ force: true });
  await pixi.getByLabel('under').click({ force: true });
  expect(await taps(page)).toEqual(['curtained', 'lid']);
});

test('position clicks an offset from the top-left corner', async ({ page, pixi }) => {
  await pixi.getByLabel('settings').click({ position: { x: 5, y: 5 } });
  const box = await pixi.getByLabel('settings').boundingBox();
  expect(box).toEqual({ x: 20, y: 70, width: 120, height: 40 });
  expect(await taps(page)).toEqual(['settings']);
});

test('hover sends real pointer movement', async ({ page, pixi }) => {
  await pixi.getByLabel('play').hover();
  await expect.poll(() => page.evaluate(() => document.querySelector('canvas')?.style.cursor)).toBe('pointer');
});

test('dblclick sends two clicks', async ({ page, pixi }) => {
  await pixi.getByLabel('play').dblclick();
  expect(await taps(page)).toEqual(['play', 'play']);
});
