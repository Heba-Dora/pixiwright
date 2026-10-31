# pixiwright

[![CI](https://github.com/Heba-Dora/pixiwright/actions/workflows/ci.yml/badge.svg)](https://github.com/Heba-Dora/pixiwright/actions/workflows/ci.yml)

Playwright locators, assertions, and a frozen clock for [PixiJS](https://pixijs.com) canvases.

```ts
import { expect, test } from 'pixiwright';

test('starting a game', async ({ page, pixi }) => {
  await page.goto('/');

  await pixi.getByLabel('play').click();

  await expect(pixi.getByLabel('score')).toHaveText('Score: 0');
  await expect(pixi.getByLabel('menu')).not.toBeVisible();
});
```

Your app needs no changes. pixiwright connects through the hook PixiJS calls when an application starts.

## Why

A PixiJS app is one `<canvas>` element. To Playwright that is a single opaque box, so `getByRole` finds nothing inside it. That leaves two options, and both are fragile:

- **Clicking fixed coordinates.** The test breaks when the layout moves, and it still passes if the button is hidden, because a click at (120, 80) always "works".
- **Comparing screenshots.** They fail on a font change or a one-pixel shift, and they say something looks different, not what went wrong.

pixiwright reads the live scene instead. Tests find objects by the labels you already give them, and input still goes through real mouse events at real on-screen positions, so your hit areas and event handlers run exactly as they do for a user.

When something is wrong, the error names it:

```
pixi.getByLabel('play').click: timed out after 5000ms: "play" is covered by "modal", which would receive the input at (360, 40)
pixi.getByLabel('buy').click: timed out after 5000ms: "buy"'s ancestor "shop" has alpha = 0
pixi.getByLabel('next').click: timed out after 5000ms: "next" is outside the 800×600 canvas, at (900, 20)
```

## Install

pixiwright is not on npm yet. To try it, build a package from a checkout and install that file in your project:

```sh
npm ci
npm pack
```

```sh
npm install --save-dev /path/to/pixiwright-0.1.0.tgz
```

Requires Node.js 22 or later, `@playwright/test` 1.64 or later, and PixiJS 8.2 or later.

Give the objects you want to test a label:

```ts
const button = new Sprite(texture);
button.label = 'play';
```

## API

### Finding objects

| Call | Result |
| --- | --- |
| `pixi.getByLabel(label)` | Objects whose label matches. A string must match the whole label; a `RegExp` can match part of it. |
| `pixi.getByText(text, { exact })` | `Text`, `BitmapText`, and `HTMLText` objects. A string matches any part of the text, ignoring case, unless `exact` is set. |
| `locator.getByLabel()`, `locator.getByText()` | The same, searching inside another object. |
| `locator.first()`, `.last()`, `.nth(index)` | One object from several matches. |

Locators are lazy and find the object each time they are used. Actions and text reads fail straight away if more than one object matches, instead of guessing.

### Acting

| Call | What it does |
| --- | --- |
| `locator.click(options)` | Waits until the object is actionable, then clicks it. Accepts `button`, `clickCount`, `delay`, `position`, `force`, and `timeout`. |
| `locator.dblclick(options)` | Two clicks. |
| `locator.hover(options)` | Moves the mouse onto the object. |

Before acting, pixiwright waits for the object to exist and be drawn on the canvas, for its target point to hold still for a frame, and for PixiJS's own hit test to confirm the object would receive the input. A target that pulses around its center counts as still. It scrolls the page if the target is outside the viewport, and refuses if an HTML element sits over the canvas at that point. Positions stay correct at any device pixel ratio, when CSS scales the canvas, and on a scrolled page.

`position` is an offset from the object's top-left corner, in PixiJS units. `force: true` skips the input checks, but the object must still exist and be visible. The default timeout is 5 seconds.

### Reading

| Call | Result |
| --- | --- |
| `locator.count()` | Number of matches right now. |
| `locator.isVisible()` | Whether the object is drawn on the canvas right now. |
| `locator.textContent()` | Text of the object and its descendants. |
| `locator.boundingBox()` | Visible portion in CSS pixels relative to the viewport. |
| `locator.describe()` | Everything above, plus alpha, type, and the reason it is hidden, for each match. |
| `pixi.scene(options)` | The scene as text. |
| `pixi.canvasImage()` | PNG of the canvas. |

### Asserting

Import `expect` from `pixiwright`. These retry until they pass or time out, and DOM locators keep working with the same `expect`.

| Assertion | Passes when |
| --- | --- |
| `expect(locator).toBeVisible()` | The object is drawn on the canvas. Hidden, fully transparent, masked-out, and off-canvas objects are not. |
| `expect(locator).toHaveText(text)` | Its text matches. |
| `expect(locator).toHaveCount(count)` | That many objects match. |
| `expect(pixi).toMatchScene('menu.txt', options)` | The scene matches a stored text file. |

`toMatchScene` works like `toMatchSnapshot`: the first run writes the file and fails so you can check it, and `--update-snapshots` rewrites it. A stored scene reads like this, so a change shows up in a normal code review:

```
- Container "menu" [20, 20, 120, 90]
  - Graphics "play" [20, 20, 120, 40]
    - Text "play-label": "Play" [60, 28, 35.02, 19.92]
  - Graphics "settings" [20, 70, 120, 40]
- Graphics "ghost" (hidden: "ghost" has alpha = 0)
```

By default only objects with a label or text are listed. Pass `all: true` to list everything, `labels: /regex/` to compare part of a busy scene, and `bounds: false` to leave out positions, which helps when text is measured with different fonts on different machines.

### Controlling time

Animated scenes rarely hold still for an assertion. Freeze the clock and move it one frame at a time:

```ts
test.use({ pixiClock: 'frozen' });

test('the coin lands after a second', async ({ page, pixi }) => {
  await page.goto('/');

  await pixi.clock.step(60);

  await expect(pixi.getByLabel('coin')).toBeVisible();
});
```

With `pixiClock: 'frozen'` the clock stops the moment the app starts, so no frames run before your first step, and the same steps give the same scene and the same pixels on every run. Every step advances a fixed duration.

| Call | What it does |
| --- | --- |
| `pixi.clock.freeze()` | Stops the clock partway through a test. |
| `pixi.clock.step(frames, { fps })` | Advances by whole frames and renders. Defaults to one frame at 60 fps. |
| `pixi.clock.resume()` | Lets the clock run again. |
| `pixi.clock.isFrozen()` | Whether the clock is stopped. |

Clicks still work on a frozen scene.

### Failure reports

When a test using the `pixi` fixture fails, the scene tree and a canvas image are attached to its Playwright report. To do this yourself, call `attachPixiState(pixi, testInfo)`.

### Without the fixture

```ts
import { connectPixi } from 'pixiwright';

const pixi = await connectPixi(page, { timeout: 2000 });
await page.goto('/');
```

Call `connectPixi` before the page loads. If the app has already started, have it set `window.__PIXI_DEVTOOLS__ = { app }`. On a page with several apps, `appIndex` picks one, in start order.

## Known limits

- **Only PixiJS tickers freeze.** `setTimeout`, `Date`, GSAP, and animation loops of your own keep running on real time.
- **`clock.step` needs 10 fps or more.** PixiJS caps each frame at 100 ms by default, so slower steps would lose time. A ticker with `maxFPS` set can also skip steps shorter than its frame budget.
- **A non-interactive object only counts as a cover when it is drawn over the whole target.** PixiJS lets input pass through such objects, and a label on a button is ordinary, so a partial cover is not refused. Give decorative overlays `eventMode = 'none'` so they never count.
- **Cover detection does not read pixels.** A mostly transparent sprite over a target counts as covering it, and `RenderLayer` draw order is not considered.
- **Visibility treats inverse masks like normal masks,** and reads any other mask by its bounding box.
- **There is no drag helper yet.** Use `boundingBox()` with `page.mouse`.
- **`Application` only.** An app that drives a bare `Renderer` is not found.
- **Main frame only.** Canvases inside iframes are not supported.
- **PixiJS 8.2 is the oldest supported version.** The tests pass on 8.2.0 and 8.22.0. Earlier 8.x releases do not have the startup hook and are untested.
- **Tested on Chrome** with WebGL and WebGPU. Firefox and WebKit are untested.

## How it works

The design and the reasoning behind it are in [docs/DESIGN.md](docs/DESIGN.md).

## Development

```sh
npm ci
npm test
```

Tests run the real library against a real PixiJS app in Chrome. Local runs use your installed Chrome; CI installs Playwright's Chromium.

## License

MIT
