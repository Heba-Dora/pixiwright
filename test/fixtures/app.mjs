// A stock PixiJS app. It knows nothing about pixiwright; window.taps only lets tests see its handlers fire.
import { Application, Container, Graphics, Rectangle, Text } from '/pixi.mjs';

const params = new URLSearchParams(location.search);
const app = new Application();
await app.init({
  width: 800,
  height: 600,
  background: '#101820',
  preference: params.get('renderer') ?? 'webgl',
  resolution: params.has('density') ? devicePixelRatio : 1,
  autoDensity: params.has('density'),
  sharedTicker: params.has('sharedTicker'),
});

document.querySelector('#spacer').style.height = `${params.get('spacer') ?? 0}px`;
document.querySelector('#stage').append(app.canvas);
if (params.has('cssScale')) app.canvas.style.width = `${800 * Number(params.get('cssScale'))}px`;
if (params.has('offsetX')) app.canvas.style.marginLeft = `${params.get('offsetX')}px`;
if (params.has('devtools')) globalThis.__PIXI_DEVTOOLS__ = { app };

window.taps = [];
window.callAppStart = () => app.start();
window.rendererName = app.renderer.name;
window.destroyApp = () => app.destroy(true);

function box(label, x, y, parent = app.stage, { width = 120, height = 40, color = 0x3a7bd5 } = {}) {
  const shape = new Graphics().rect(0, 0, width, height).fill(color);
  shape.label = label;
  shape.position.set(x, y);
  parent.addChild(shape);
  return shape;
}

function button(label, x, y, parent = app.stage, options) {
  const shape = box(label, x, y, parent, options);
  shape.eventMode = 'static';
  shape.cursor = 'pointer';
  shape.on('pointertap', () => window.taps.push(label));
  return shape;
}

function text(label, value, x, y, parent = app.stage) {
  const object = new Text({ text: value, style: { fontFamily: 'Arial', fontSize: 18, fill: 0xffffff } });
  object.label = label;
  object.position.set(x, y);
  parent.addChild(object);
  return object;
}

let score = 0;
const scoreText = text('score', 'Score: 0', 640, 10);
const frames = text('frames', 'Frames: 0', 640, 40);

const menu = new Container({ label: 'menu' });
menu.position.set(20, 20);
app.stage.addChild(menu);
const play = button('play', 0, 0, menu);
text('play-label', 'Play', 40, 8, play);
play.on('pointertap', () => {
  score += 1;
  scoreText.text = `Score: ${score}`;
});
button('settings', 0, 50, menu);

button('ghost', 160, 20).alpha = 0;
button('invisible', 160, 70).visible = false;
const faded = new Container({ label: 'faded' });
faded.alpha = 0;
app.stage.addChild(faded);
button('faded-child', 160, 120, faded);
const dimmed = new Container({ label: 'dimmed' });
dimmed.alpha = 0.5;
app.stage.addChild(dimmed);
button('dimmed-child', 160, 170, dimmed);

button('under', 300, 20);
button('lid', 300, 20, app.stage, { color: 0xd53a3a });
button('curtained', 300, 70);
box('curtain', 290, 60, app.stage, { width: 140, height: 60, color: 0x202020 });
button('badged', 300, 130);
text('badge', 'New', 345, 140);
button('decorated', 300, 180);
box('glow', 290, 170, app.stage, { width: 140, height: 60, color: 0x444444 }).eventMode = 'none';

const clipped = new Container({ label: 'viewport' });
clipped.position.set(20, 200);
app.stage.addChild(clipped);
const mask = new Graphics().rect(0, 0, 120, 40).fill(0xffffff);
mask.position.set(20, 200);
app.stage.addChild(mask);
clipped.mask = mask;
button('inside', 0, 0, clipped);
button('outside', 200, 0, clipped);

const ownMask = new Graphics().rect(0, 0, 10, 10).fill(0xffffff);
ownMask.position.set(600, 560);
app.stage.addChild(ownMask);
button('self-masked', 20, 250).mask = ownMask;
button('unrendered', 160, 250).renderable = false;

const panel = button('panel', 20, 510, app.stage, { width: 300, height: 70, color: 0x2a3a4a });
const corner = button('corner-only', 20, 10, panel);
corner.hitArea = new Rectangle(0, 0, 10, 10);

button('offscreen', 900, 20);
button('edge', 740, 340);
box('plain', 20, 300);
button('twin', 160, 300);
button('twin', 290, 300);

const swap = new Graphics().rect(0, 0, 120, 40).fill(0x3ad57b);
swap.label = 'swap';
swap.position.set(430, 20);
swap.eventMode = 'static';
swap.on('pointertap', () => {
  setTimeout(() => {
    status.text = 'Ready';
    target.visible = false;
  }, 200);
});
app.stage.addChild(swap);
const status = text('status', 'Waiting', 560, 28);
const target = box('swap-target', 430, 70);

if (!params.has('noTimers')) setTimeout(() => button('late', 430, 130), 300);

const dart = button('dart', 20, 360, app.stage, { width: 30, height: 30 });
let dartFrames = 0;
window.launchDart = () => {
  dartFrames = 18;
};
const runner = button('runner', 20, 400);
const pulse = button('pulse', 460, 440);
pulse.pivot.set(60, 20);
const spinner = box('spinner', 660, 480, app.stage, { width: 80, height: 20, color: 0xd5c33a });
spinner.pivot.set(40, 10);

let elapsed = 0;
let frameCount = 0;
app.ticker.add((ticker) => {
  frameCount += 1;
  frames.text = `Frames: ${frameCount}`;
  elapsed += ticker.deltaMS;
  // Each frame moves it further than its own width, so a click at a stale position misses.
  if (dartFrames > 0) {
    dartFrames -= 1;
    dart.x = 20 + dartFrames * 40;
  }
  runner.x = Math.min(240, 20 + elapsed * 0.45);
  pulse.scale.set(1 + 0.1 * Math.sin(elapsed / 150));
  spinner.rotation = elapsed / 500;
});

if (params.has('second')) {
  const second = new Application();
  await second.init({ width: 200, height: 100, background: '#203040' });
  document.body.append(second.canvas);
  const shape = new Graphics().rect(0, 0, 120, 40).fill(0x3a7bd5);
  shape.label = 'second-button';
  shape.eventMode = 'static';
  shape.on('pointertap', () => window.taps.push('second-button'));
  second.stage.addChild(shape);
}

window.fixtureReady = true;
