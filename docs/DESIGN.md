# Design

pixiwright has two halves. The agent (`src/agent.ts`) runs in the page and reads the live scene. Everything else runs in the Playwright process, asks the agent questions, retries, and sends input. They share only the JSON types in `src/types.ts`.

## Connecting without touching the app

PixiJS 8 calls `globalThis.__PIXI_APP_INIT__` when an `Application` starts. Defining that function before the page's scripts run is enough to find the app, so tests need no test-only code in production.

The hook has to exist before the app starts, so it is installed on the browser context and not in the `pixi` fixture. A `beforeEach` that opens the page runs before a fixture only the test body asks for, and the app would start unseen. The context is set up first, and it also covers pages a test opens later.

`__PIXI_DEVTOOLS__` is the fallback for pages that were already running when pixiwright connected.

## The agent is one function

Playwright sends a function to the page with `toString()`, so `installAgent` must be self-contained: no runtime imports and no helpers at module level. The trade-off is one long function. In return there is no bundler and no second build, and what ships is the same code the type checker saw. Types are checked against the real `pixi.js` package, which is only a development dependency.

## Real input

Actions use `page.mouse` at computed viewport coordinates and never emit events into PixiJS. A synthetic event would bypass hit areas, `eventMode`, and anything else between the pointer and the handler, which is usually what a test is trying to prove.

Coordinates are the exact inverse of `EventSystem.mapPositionToPoint`, so input lands where PixiJS will map it back from. That covers device pixel ratio, CSS scaling, and page scrolling with one formula. A CSS rotation is not handled by either, so the two stay consistent.

## Would this object receive the input?

PixiJS's hit test is the authority, because it is what will decide. pixiwright calls `rootBoundary.hitTest` at the target point and accepts the result if the hit lands inside the target. A non-interactive target may also pass the hit to an interactive parent, as a label inside a button does. An interactive target may not: its own handler would never fire.

The hit test cannot see one important failure. PixiJS input passes through non-interactive objects, so an opaque panel with the default `eventMode` lets a click reach a button nobody can see. A user would be pressing something hidden. Treating every object drawn on top as a cover would be wrong the other way, because a label drawn as a sibling over a button is ordinary. So an object only counts as a cover if it is non-interactive, is drawn after the target, and encloses the target's whole visible area. Full-screen decoration can still trip this; `eventMode = 'none'` is the standard way to mark it, and the error says so.

## What counts as visible

An object is visible when it, and every ancestor, has `visible`, `renderable`, and non-zero alpha, and when some part of it survives every mask and falls on the canvas. Off-canvas counts as hidden because, unlike a page, a canvas cannot be scrolled to reveal it.

Mask handling has one trap. When a mask misses its object completely, `getBounds()` does not return an empty rectangle: the inverted intersection is folded back into a normal one spanning the gap between the two. Each mask in the chain, including the object's own, is therefore intersected explicitly. PixiJS flags masks as not measurable, so their bounds are read the way PixiJS reads them, by setting `measurable` for the duration of the call.

## Labels

PixiJS labels objects with their type by default, so every `Sprite` is labelled `"Sprite"`. pixiwright treats those as unlabelled. Otherwise the default scene tree would list every sprite.

Types come from `renderPipeId`, not `constructor.name`, which a production bundler mangles.

## Stability

A click needs a point that held still for one animation frame. It compares the point and not the bounds, so a button pulsing around its center is clickable, which is common in games and would otherwise never settle.

The wait has to be a real frame. A timer that fires before the frame compares the same frame with itself, and a moving target looks still, so a short timer is only for hidden pages, which run no frames. A visible page gets 2.5 seconds, half the default timeout. That rides out slow rendering, and it stops a page that has stalled from using up the action's whole timeout. A stall longer than that can still make a moving target look still, because nothing in the page can tell a stalled frame from a late one.

## Frozen time

Tickers read time from an argument, so a frozen clock is a stopped ticker plus explicit `update()` calls. Three details matter:

- Every run starts from `lastTime = 0` and steps through multiples of the frame length. Starting from `performance.now()` would make each delta differ in its last bits between runs, and small differences reach the scene and the pixels.
- `start` is replaced while frozen. `Ticker.add()` and `Application.start()` would otherwise restart the ticker and quietly end the freeze.
- `pixiClock: 'frozen'` freezes in a microtask from the startup hook. That runs after `Application.init()` has started the ticker and before the page's code continues, so no frame slips through.

A frozen clock stops time, not drawing. Before each action the agent renders once, because PixiJS hit tests the transforms from the last render.

## Snapshots

`toMatchScene` does not wrap `toMatchSnapshot`, which compares once. A scene is live, so it has its own read, compare, and retry loop, and it follows the same update rules. At runtime the unset `updateSnapshots` value is `'default'`, which is not in Playwright's types, so the code checks for the values that accept a change and treats everything else as the default.

## Testing

Tests drive a stock PixiJS app in real Chrome. There are no mocks, because the risky parts are the seams with PixiJS and the browser. The app knows nothing about pixiwright; it only records which of its handlers fired, so a test can show that input arrived.

Failure attachments only exist once a test has failed, so `test/report.spec.ts` runs deliberately failing tests in a child Playwright and reads its JSON report.
