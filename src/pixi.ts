import type { ElementHandle, Page, TestInfo } from '@playwright/test';
import { installAgent } from './agent.js';
import { PixiLocator } from './locator.js';
import { sleep } from './poll.js';
import type { PixiAgent, SceneOptions } from './types.js';

export type ClockMode = 'real' | 'frozen';

export interface PixiOptions {
  /** Which application to use when the page has several, in start order. */
  appIndex?: number;
  /** Default wait for actions, in milliseconds. */
  timeout?: number;
  /** 'frozen' stops the clock the moment the app starts. Applies to pages loaded after connecting. */
  clock?: ClockMode;
}

type AgentMethod = keyof PixiAgent;
type AppArgs<K extends AgentMethod> = Parameters<PixiAgent[K]> extends [number, ...infer Rest] ? Rest : Parameters<PixiAgent[K]>;
type AgentResult<K extends AgentMethod> = Awaited<ReturnType<PixiAgent[K]>>;

const APP_METHODS = new Set<AgentMethod>(['count', 'describe', 'actionPoint', 'scene', 'canvas', 'freeze', 'resume', 'isFrozen', 'step', 'render']);

export class PixiClock {
  constructor(private readonly pixi: Pixi) {}

  /** Stops the app's tickers. Nothing advances until step() or resume(). */
  async freeze(): Promise<void> {
    await this.pixi.requireApp();
    await this.pixi.call('freeze');
  }

  /** Advances a frozen clock by whole frames and renders the result. step(0) only redraws. */
  async step(frames = 1, options: { fps?: number } = {}): Promise<void> {
    await this.pixi.requireApp();
    await this.pixi.call('step', frames, options.fps ?? 60);
  }

  async resume(): Promise<void> {
    await this.pixi.requireApp();
    await this.pixi.call('resume');
  }

  isFrozen(): Promise<boolean> {
    return this.pixi.call('isFrozen');
  }
}

export class Pixi {
  readonly clock = new PixiClock(this);
  readonly timeout: number;
  readonly appIndex: number;

  constructor(
    readonly page: Page,
    options: PixiOptions = {},
  ) {
    this.timeout = options.timeout ?? 5000;
    this.appIndex = options.appIndex ?? 0;
  }

  getByLabel(label: string | RegExp): PixiLocator {
    return new PixiLocator(this, [], 'pixi').getByLabel(label);
  }

  getByText(text: string | RegExp, options: { exact?: boolean } = {}): PixiLocator {
    return new PixiLocator(this, [], 'pixi').getByText(text, options);
  }

  /** The scene as text: one line per object with a label or text, indented by nesting. */
  async scene(options: SceneOptions = {}): Promise<string> {
    await this.requireApp();
    const { labels, ...rest } = options;
    const sent = labels ? { ...rest, labels: { source: labels.source, flags: labels.flags } } : rest;
    return (await this.call('scene', sent)) ?? '';
  }

  /** An image of the canvas alone, without anything the page draws over it. */
  async canvasImage(): Promise<Buffer> {
    await this.requireApp();
    await this.call('render');
    const handle = await this.page.evaluateHandle(
      (index) => (globalThis as unknown as { __pixiwright__: PixiAgent }).__pixiwright__.canvas(index),
      this.appIndex,
    );
    try {
      return await (handle as ElementHandle<HTMLCanvasElement>).screenshot();
    } finally {
      await handle.dispose();
    }
  }

  /** Waits for the app to start. Queries do this on their own; this is for checking setup. */
  async requireApp(timeout = this.timeout): Promise<void> {
    const deadline = Date.now() + timeout;
    while ((await this.attempt('appCount') ?? 0) <= this.appIndex) {
      if (Date.now() >= deadline) {
        throw new Error(
          `no PixiJS application was found on this page after ${timeout}ms. pixiwright connects when PixiJS starts, so connect before the page loads, or set window.__PIXI_DEVTOOLS__ = { app } if the app started first`,
        );
      }
      await sleep(50);
    }
  }

  /** Calls the page agent. Methods that act on an app use this handle's app. */
  call<K extends AgentMethod>(method: K, ...args: AppArgs<K>): Promise<AgentResult<K>> {
    const full = APP_METHODS.has(method) ? [this.appIndex, ...args] : args;
    return this.page.evaluate(
      ([name, values]) => {
        const agent = (globalThis as unknown as { __pixiwright__: Record<string, (...input: unknown[]) => unknown> }).__pixiwright__;
        return agent[name as string]!(...(values as unknown[]));
      },
      [method, full],
    ) as Promise<AgentResult<K>>;
  }

  /** Like call(), but a navigation in progress returns undefined so the caller can retry. */
  async attempt<K extends AgentMethod>(method: K, ...args: AppArgs<K>): Promise<AgentResult<K> | undefined> {
    try {
      return await this.call(method, ...args);
    } catch (error) {
      if (error instanceof Error && /Execution context was destroyed|Cannot find context/.test(error.message)) return undefined;
      throw error;
    }
  }
}

/** Connects to a page. Call it before the page loads so the app is seen as it starts. */
export async function connectPixi(page: Page, options: PixiOptions = {}): Promise<Pixi> {
  const config = { freeze: options.clock === 'frozen' };
  await page.addInitScript(installAgent, config);
  await page.evaluate(installAgent, config);
  return new Pixi(page, options);
}

/** Attaches the scene tree and a canvas image to a test's report. */
export async function attachPixiState(pixi: Pixi, testInfo: TestInfo): Promise<void> {
  if ((await pixi.attempt('appCount') ?? 0) <= pixi.appIndex) return;
  await testInfo.attach('pixi-scene', { body: await pixi.scene({ all: true }), contentType: 'text/plain' });
  await testInfo.attach('pixi-canvas', { body: await pixi.canvasImage(), contentType: 'image/png' });
}

