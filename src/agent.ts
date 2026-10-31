import type { Application, Bounds, Container, Ticker } from 'pixi.js';
import type { ActionFailure, ActionProbe, ActionProbeOptions, AgentConfig, AgentSceneOptions, Matcher, NodeInfo, PixiAgent, Point, Query, Rect } from './types.js';

interface AgentScope {
  __pixiwright__?: PixiAgent;
  __PIXI_APP_INIT__?: (target: unknown, version: string) => void;
  __PIXI_DEVTOOLS__?: { app?: Application };
}

interface HeldTicker {
  ticker: Ticker;
  started: boolean;
}

interface FrozenClock {
  held: HeldTicker[];
  frame: number;
}

type Sight =
  | { visible: true; rect: Rect; bounds: Rect }
  | { visible: false; code: ActionFailure; reason: string };

/**
 * Runs inside the page. Playwright serializes this function with toString(),
 * so it must stay self-contained: no imports at runtime and no module-level helpers.
 */
export function installAgent(config: AgentConfig = {}): void {
  const scope = globalThis as unknown as AgentScope;
  if (scope.__pixiwright__) return;

  const apps: Application[] = [];
  const clocks = new WeakMap<Application, FrozenClock>();
  const viewTypes: Record<string, string> = {
    bitmapText: 'BitmapText',
    customRender: 'RenderContainer',
    graphics: 'Graphics',
    htmlText: 'HTMLText',
    mesh: 'Mesh',
    nineSliceSprite: 'NineSliceSprite',
    particle: 'ParticleContainer',
    sprite: 'Sprite',
    text: 'Text',
    tilingSprite: 'TilingSprite',
  };

  function register(app: Application): void {
    if (apps.includes(app)) return;
    apps.push(app);
    // Runs after Application.init() has finished starting its ticker, before the page's code continues.
    if (config.freeze) queueMicrotask(() => freeze(app));
  }

  const previousHook = scope.__PIXI_APP_INIT__;
  scope.__PIXI_APP_INIT__ = (target, version) => {
    previousHook?.(target, version);
    if (target && typeof target === 'object' && 'stage' in target) register(target as Application);
  };

  function liveApps(): Application[] {
    const devtoolsApp = scope.__PIXI_DEVTOOLS__?.app;
    if (devtoolsApp) register(devtoolsApp);
    return apps.filter((app) => app.renderer && app.stage && !app.stage.destroyed);
  }

  function typeName(node: Container): string {
    const id = (node as Container & { renderPipeId?: string }).renderPipeId;
    return id ? (viewTypes[id] ?? id) : 'Container';
  }

  /** Pixi labels objects with their type by default, which says nothing about the object. */
  function ownLabel(node: Container): string {
    const label = node.label;
    return label && label !== typeName(node) ? label : '';
  }

  function nameOf(node: Container): string {
    const label = ownLabel(node);
    return label ? `"${label}"` : typeName(node);
  }

  function ownText(node: Container): string | null {
    const text = (node as Container & { text?: unknown }).text;
    return typeof text === 'string' ? text : null;
  }

  function descendants(root: Container): Container[] {
    const found: Container[] = [];
    const visit = (node: Container): void => {
      for (const child of node.children) {
        found.push(child);
        visit(child);
      }
    };
    visit(root);
    return found;
  }

  function fullText(node: Container): string | null {
    const parts = [node, ...descendants(node)].map(ownText).filter((text): text is string => text !== null);
    return parts.length > 0 ? parts.join(' ') : null;
  }

  function normalize(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  function matches(value: string | null, matcher: Matcher): boolean {
    if (value === null) return false;
    if (matcher.kind === 'regex') return new RegExp(matcher.source, matcher.flags.replace(/[gy]/g, '')).test(value);
    if (matcher.exact) return value === matcher.value;
    return normalize(value).toLowerCase().includes(normalize(matcher.value).toLowerCase());
  }

  function resolve(app: Application, query: Query): Container[] {
    let current: Container[] = [app.stage];
    for (const step of query) {
      if (step.kind === 'nth') {
        const picked = current[step.index < 0 ? current.length + step.index : step.index];
        current = picked ? [picked] : [];
        continue;
      }
      const found = new Set<Container>();
      for (const root of current) {
        for (const node of descendants(root)) {
          const value = step.kind === 'label' ? ownLabel(node) : ownText(node);
          if (matches(value, step.match)) found.add(node);
        }
      }
      current = [...found];
    }
    return current;
  }

  function toRect(bounds: Bounds): Rect {
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }

  function intersect(a: Rect, b: Rect): Rect | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  }

  function encloses(outer: Rect, inner: Rect): boolean {
    return (
      outer.x <= inner.x &&
      outer.y <= inner.y &&
      outer.x + outer.width >= inner.x + inner.width &&
      outer.y + outer.height >= inner.y + inner.height
    );
  }

  /** Pixi marks masks as not measurable, so their bounds are read the way Pixi reads them. */
  function maskRect(node: Container): Rect | null {
    const mask = node.mask as unknown;
    if (!mask || typeof mask !== 'object' || !('getBounds' in mask)) return null;
    const object = mask as Container;
    const measurable = object.measurable;
    object.measurable = true;
    const rect = toRect(object.getBounds());
    object.measurable = measurable;
    return rect;
  }

  function see(app: Application, node: Container): Sight {
    const name = nameOf(node);
    for (let current: Container | null = node; current; current = current.parent) {
      const owner = current === node ? name : `${name}'s ancestor ${nameOf(current)}`;
      if (!current.visible) return { visible: false, code: 'hidden', reason: `${owner} has visible = false` };
      if (!current.renderable) return { visible: false, code: 'hidden', reason: `${owner} has renderable = false` };
      if (current.alpha <= 0) return { visible: false, code: 'hidden', reason: `${owner} has alpha = 0` };
    }

    const bounds = toRect(node.getBounds());
    if (bounds.width <= 0 || bounds.height <= 0) return { visible: false, code: 'no-size', reason: `${name} has no size` };

    // The object's own mask counts too: when it misses completely, getBounds() returns the gap between them.
    let rect: Rect = bounds;
    for (let current: Container | null = node; current; current = current.parent) {
      const mask = maskRect(current);
      if (!mask) continue;
      const clipped = intersect(rect, mask);
      if (!clipped) {
        const owner = current === node ? 'its own mask' : `${nameOf(current)}'s mask`;
        return { visible: false, code: 'masked', reason: `${name} is masked out by ${owner}` };
      }
      rect = clipped;
    }

    const screen = app.renderer.screen;
    const canvasRect = { x: screen.x, y: screen.y, width: screen.width, height: screen.height };
    const onCanvas = intersect(rect, canvasRect);
    if (!onCanvas) {
      return {
        visible: false,
        code: 'off-canvas',
        reason: `${name} is outside the ${canvasRect.width}×${canvasRect.height} canvas, at (${Math.round(rect.x)}, ${Math.round(rect.y)})`,
      };
    }
    return { visible: true, rect: onCanvas, bounds };
  }

  function canvasOf(app: Application): HTMLCanvasElement {
    return app.renderer.events.domElement as HTMLCanvasElement;
  }

  /** The inverse of EventSystem.mapPositionToPoint, so input lands where Pixi will map it back from. */
  function toClient(app: Application, point: Point): Point {
    const canvas = canvasOf(app);
    const box = canvas.getBoundingClientRect();
    const resolution = app.renderer.events.resolution;
    return {
      x: box.left + point.x * resolution * (box.width / canvas.width),
      y: box.top + point.y * resolution * (box.height / canvas.height),
    };
  }

  function toClientRect(app: Application, rect: Rect): Rect {
    const start = toClient(app, rect);
    const end = toClient(app, { x: rect.x + rect.width, y: rect.y + rect.height });
    return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
  }

  function inViewport(point: Point): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < window.innerWidth && point.y < window.innerHeight;
  }

  function globalAlpha(node: Container): number {
    let alpha = 1;
    for (let current: Container | null = node; current; current = current.parent) alpha *= current.alpha;
    return alpha;
  }

  function isInside(ancestor: Container, node: Container): boolean {
    for (let current: Container | null = node; current; current = current.parent) {
      if (current === ancestor) return true;
    }
    return false;
  }

  function hitAt(app: Application, point: Point): Container | null {
    const boundary = app.renderer.events.rootBoundary;
    // Pixi assigns this itself at the start of every pointer event.
    boundary.rootTarget = app.renderer.lastObjectRendered as Container;
    return boundary.hitTest(point.x, point.y) ?? null;
  }

  /**
   * Finds a non-interactive object drawn over the whole target. Pixi lets input pass
   * through those, so the hit test cannot see them. Requiring full coverage keeps a
   * label sitting on a button from counting as a cover.
   */
  function findCurtain(app: Application, target: Container, rect: Rect, point: Point): Container | null {
    let passedTarget = false;
    let curtain: Container | null = null;
    const paintsOver = (node: Container): boolean => {
      const object = node as Container & { containsPoint?: (local: Point) => boolean };
      if (typeof object.containsPoint !== 'function') return false;
      const sight = see(app, node);
      return sight.visible && encloses(sight.rect, rect) && object.containsPoint(node.toLocal(point));
    };
    const visit = (node: Container): void => {
      if (!node.visible || !node.renderable || node.alpha <= 0 || !node.measurable) return;
      if (node === target) {
        passedTarget = true;
        return;
      }
      if (passedTarget && node.eventMode !== 'none' && paintsOver(node)) curtain = node;
      for (const child of node.children) visit(child);
    };
    visit(app.stage);
    return curtain;
  }

  function fail(code: ActionFailure, message: string): ActionProbe {
    return { ok: false, code, message };
  }

  function noApp(): ActionProbe {
    return fail(
      'no-app',
      'no PixiJS application was found on this page. pixiwright connects when PixiJS starts, so connect before the page loads, or set window.__PIXI_DEVTOOLS__ = { app } if the app started first',
    );
  }

  function actionPoint(index: number, query: Query, options: ActionProbeOptions): ActionProbe {
    const app = liveApps()[index];
    if (!app) return noApp();
    // A frozen clock stops time, not drawing. Pixi hit tests the last rendered transforms.
    if (clocks.has(app)) app.render();
    if (!app.renderer.lastObjectRendered) return fail('not-rendered', 'the app has not rendered a frame yet');

    const nodes = resolve(app, query);
    const node = nodes[0];
    if (!node) return fail('not-found', 'no matching object in the scene');
    if (nodes.length > 1) {
      return fail('ambiguous', `strict mode violation: ${nodes.length} objects match: ${nodes.slice(0, 5).map(nameOf).join(', ')}`);
    }

    const sight = see(app, node);
    if (!sight.visible) return fail(sight.code, sight.reason);

    const name = nameOf(node);
    const point = options.position
      ? { x: sight.bounds.x + options.position.x, y: sight.bounds.y + options.position.y }
      : { x: sight.rect.x + sight.rect.width / 2, y: sight.rect.y + sight.rect.height / 2 };

    let client = toClient(app, point);
    if (!inViewport(client)) {
      canvasOf(app).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      client = toClient(app, point);
    }
    if (!inViewport(client)) {
      window.scrollBy({
        left: client.x - window.innerWidth / 2,
        top: client.y - window.innerHeight / 2,
        behavior: 'instant',
      });
      client = toClient(app, point);
    }
    if (options.force) return { ok: true, x: client.x, y: client.y };
    if (!inViewport(client)) return fail('outside-viewport', `${name} could not be scrolled into the viewport`);

    const canvas = canvasOf(app);
    const root = canvas.getRootNode() as Document | ShadowRoot;
    const element = root.elementFromPoint(client.x, client.y);
    if (element !== canvas) {
      const tag = element ? `<${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}>` : 'nothing';
      return fail('dom-covered', `${name} is under ${tag} in the page, which would receive the input instead of the canvas`);
    }

    const at = `at (${Math.round(point.x)}, ${Math.round(point.y)})`;
    const hit = hitAt(app, point);
    if (!hit) {
      return fail('not-interactive', `${name} would not receive the input: nothing interactive is ${at}, and its eventMode is "${node.eventMode}"`);
    }
    // An interactive target must take the hit itself. Anything else may pass it to an interactive parent.
    if (!isInside(node, hit) && (node.isInteractive() || !isInside(hit, node))) {
      return fail('covered', `${name} is covered by ${nameOf(hit)}, which would receive the input ${at}`);
    }

    const curtain = findCurtain(app, node, sight.rect, point);
    if (curtain) {
      const cover = nameOf(curtain);
      return fail(
        'curtained',
        `${name} is covered by ${cover}, which is drawn over it but takes no pointer events, so input would pass through to something a user cannot see. Set eventMode = 'none' on ${cover} if it is decoration, or pass { force: true }`,
      );
    }
    return { ok: true, x: client.x, y: client.y };
  }

  function describeNode(app: Application, node: Container): NodeInfo {
    const sight = see(app, node);
    return {
      name: nameOf(node),
      type: typeName(node),
      text: fullText(node),
      visible: sight.visible,
      hiddenReason: sight.visible ? null : sight.reason,
      alpha: globalAlpha(node),
      bounds: sight.visible ? sight.rect : null,
      box: sight.visible ? toClientRect(app, sight.rect) : null,
    };
  }

  function round(value: number): number {
    return Math.round(value * 100) / 100 + 0;
  }

  function sceneLine(app: Application, node: Container, depth: number, options: AgentSceneOptions): string {
    const label = ownLabel(node);
    const text = ownText(node);
    const sight = see(app, node);
    const alpha = globalAlpha(node);
    const parts = [`${'  '.repeat(depth)}- ${typeName(node)}`];
    if (label) parts.push(JSON.stringify(label));
    if (text !== null) parts[parts.length - 1] += `: ${JSON.stringify(text)}`;
    if (sight.visible) {
      const { x, y, width, height } = sight.rect;
      if (options.bounds !== false) parts.push(`[${round(x)}, ${round(y)}, ${round(width)}, ${round(height)}]`);
      if (alpha < 1) parts.push(`alpha=${round(alpha)}`);
    } else {
      parts.push(`(hidden: ${sight.reason})`);
    }
    return parts.join(' ');
  }

  function scene(app: Application, options: AgentSceneOptions): string {
    const lines: string[] = [];
    const only = options.labels ? new RegExp(options.labels.source, options.labels.flags.replace(/[gy]/g, '')) : null;
    const visit = (node: Container, depth: number): void => {
      const label = ownLabel(node);
      const shown = only ? only.test(label) : options.all === true || label !== '' || ownText(node) !== null;
      if (shown) lines.push(sceneLine(app, node, depth, options));
      for (const child of node.children) visit(child, shown ? depth + 1 : depth);
    };
    for (const child of app.stage.children) visit(child, 0);
    return lines.join('\n');
  }

  function freeze(app: Application): void {
    if (clocks.has(app) || !app.ticker) return;
    const tickers = new Set<Ticker>([app.ticker, (app.ticker.constructor as typeof Ticker).shared]);
    const held = [...tickers].map((ticker) => {
      const started = ticker.started;
      ticker.stop();
      // Ticker.add() and Application.start() would otherwise restart it behind the test's back.
      ticker.start = () => {};
      // A fixed origin makes every step's delta the same on every run.
      ticker.lastTime = 0;
      return { ticker, started };
    });
    clocks.set(app, { held, frame: 0 });
  }

  function resume(app: Application): void {
    const clock = clocks.get(app);
    if (!clock) return;
    for (const { ticker, started } of clock.held) {
      delete (ticker as Partial<Ticker>).start;
      if (started) ticker.start();
    }
    clocks.delete(app);
  }

  function step(app: Application, frames: number, fps: number): void {
    const clock = clocks.get(app);
    if (!clock) throw new Error('freeze the clock before stepping it');
    const frameMs = 1000 / fps;
    for (let i = 0; i < frames; i++) {
      clock.frame += 1;
      const time = clock.frame * frameMs;
      for (const { ticker } of clock.held) ticker.update(time);
    }
    if (frames === 0) app.render();
  }

  function withApp(index: number, action: (app: Application) => void): boolean {
    const app = liveApps()[index];
    if (!app) return false;
    action(app);
    return true;
  }

  scope.__pixiwright__ = {
    appCount: () => liveApps().length,
    count(index, query) {
      const app = liveApps()[index];
      return app ? resolve(app, query).length : 0;
    },
    describe(index, query) {
      const app = liveApps()[index];
      return app ? resolve(app, query).map((node) => describeNode(app, node)) : [];
    },
    actionPoint,
    scene(index, options) {
      const app = liveApps()[index];
      return app ? scene(app, options) : null;
    },
    canvas(index) {
      const app = liveApps()[index];
      return app ? canvasOf(app) : null;
    },
    freeze: (index) => withApp(index, freeze),
    resume: (index) => withApp(index, resume),
    isFrozen(index) {
      const app = liveApps()[index];
      return app ? clocks.has(app) : false;
    },
    step: (index, frames, fps) => withApp(index, (app) => step(app, frames, fps)),
    render: (index) => withApp(index, (app) => app.render()),
    nextFrame: () =>
      new Promise((resolveFrame) => {
        // Hidden pages run no animation frames. A visible page may just be slow, and resolving
        // early would make a moving target look still, but it must not use up an action's timeout.
        const fallback = setTimeout(resolveFrame, document.hidden ? 100 : 2500);
        requestAnimationFrame(() => {
          clearTimeout(fallback);
          resolveFrame();
        });
      }),
  };
}
