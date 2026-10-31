import type { Pixi } from './pixi.js';
import { attempts } from './poll.js';
import type { ActionProbe, ActionProbeOptions, Matcher, NodeInfo, Point, Query, QueryStep, Rect } from './types.js';

export interface ActionOptions {
  /** Skip the checks that decide whether the object would receive the input. */
  force?: boolean;
  /** Offset from the object's top-left corner, in Pixi units. Defaults to its center. */
  position?: Point;
  /** Milliseconds to wait for the object to become actionable. */
  timeout?: number;
}

export interface ClickOptions extends ActionOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  /** Milliseconds between mouse down and mouse up. */
  delay?: number;
}

export function toMatcher(value: string | RegExp, exact: boolean): Matcher {
  return typeof value === 'string'
    ? { kind: 'string', value, exact }
    : { kind: 'regex', source: value.source, flags: value.flags };
}

function show(value: string | RegExp): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

export class PixiLocator {
  constructor(
    readonly pixi: Pixi,
    readonly query: Query,
    readonly description: string,
  ) {}

  /** Objects under this one whose label matches. Strings match the whole label. */
  getByLabel(label: string | RegExp): PixiLocator {
    return this.#then({ kind: 'label', match: toMatcher(label, true) }, `getByLabel(${show(label)})`);
  }

  /** Text objects under this one. Strings match any part of the text, ignoring case, unless `exact` is set. */
  getByText(text: string | RegExp, options: { exact?: boolean } = {}): PixiLocator {
    return this.#then({ kind: 'text', match: toMatcher(text, options.exact ?? false) }, `getByText(${show(text)})`);
  }

  first(): PixiLocator {
    return this.nth(0);
  }

  last(): PixiLocator {
    return this.nth(-1);
  }

  nth(index: number): PixiLocator {
    return this.#then({ kind: 'nth', index }, `nth(${index})`);
  }

  /** Number of objects that match right now. Does not wait. */
  count(): Promise<number> {
    return this.pixi.call('count', this.query);
  }

  /** Everything the agent can see about each matching object right now. Does not wait. */
  describe(): Promise<NodeInfo[]> {
    return this.pixi.call('describe', this.query);
  }

  /** The one matching object, null if there is none, or undefined while the page navigates. Throws on several. */
  async single(): Promise<NodeInfo | null | undefined> {
    const found = await this.pixi.attempt('describe', this.query);
    if (!found) return undefined;
    if (found.length > 1) {
      throw new Error(`${this.description}: strict mode violation: ${found.length} objects match: ${found.slice(0, 5).map((node) => node.name).join(', ')}`);
    }
    return found[0] ?? null;
  }

  /** Whether the single matching object is drawn on the canvas right now. Does not wait. */
  async isVisible(): Promise<boolean> {
    return (await this.single())?.visible ?? false;
  }

  /** Text of the object and its descendants. Waits for the object to exist. */
  async textContent(options: { timeout?: number } = {}): Promise<string | null> {
    return (await this.#waitForOne('textContent', options.timeout)).text;
  }

  /** Visible portion in CSS pixels relative to the viewport. Waits for the object to exist. */
  async boundingBox(options: { timeout?: number } = {}): Promise<Rect | null> {
    return (await this.#waitForOne('boundingBox', options.timeout)).box;
  }

  async click(options: ClickOptions = {}): Promise<void> {
    const { x, y } = await this.#actionPoint('click', options);
    const { button, clickCount, delay } = options;
    await this.pixi.page.mouse.click(x, y, {
      ...(button !== undefined && { button }),
      ...(clickCount !== undefined && { clickCount }),
      ...(delay !== undefined && { delay }),
    });
  }

  dblclick(options: Omit<ClickOptions, 'clickCount'> = {}): Promise<void> {
    return this.click({ ...options, clickCount: 2 });
  }

  async hover(options: ActionOptions = {}): Promise<void> {
    const { x, y } = await this.#actionPoint('hover', options);
    await this.pixi.page.mouse.move(x, y);
  }

  toString(): string {
    return this.description;
  }

  #then(step: QueryStep, part: string): PixiLocator {
    return new PixiLocator(this.pixi, [...this.query, step], `${this.description}.${part}`);
  }

  async #waitForOne(action: string, timeout = this.pixi.timeout): Promise<NodeInfo> {
    for await (const _ of attempts(timeout)) {
      const found = await this.single();
      if (found) return found;
    }
    throw new Error(`${this.description}.${action}: timed out after ${timeout}ms: no matching object in the scene`);
  }

  /** Retries until the object would receive input at a point that held still for a frame. */
  async #actionPoint(action: string, options: ActionOptions): Promise<{ x: number; y: number }> {
    const timeout = options.timeout ?? this.pixi.timeout;
    const probeOptions: ActionProbeOptions = {
      ...(options.force !== undefined && { force: options.force }),
      ...(options.position !== undefined && { position: options.position }),
    };
    let last: ActionProbe | undefined;
    let previous: { x: number; y: number } | null = null;

    for await (const _ of attempts(timeout)) {
      last = await this.pixi.attempt('actionPoint', this.query, probeOptions);
      if (!last) continue;
      if (!last.ok) {
        if (last.code === 'ambiguous') throw new Error(`${this.description}.${action}: ${last.message}`);
        previous = null;
        continue;
      }
      if (options.force || (previous && previous.x === last.x && previous.y === last.y)) return last;
      previous = { x: last.x, y: last.y };
      await this.pixi.attempt('nextFrame');
    }

    const reason = last?.ok === false ? last.message : last?.ok ? 'the object did not hold still for a frame' : 'the page kept navigating';
    throw new Error(`${this.description}.${action}: timed out after ${timeout}ms: ${reason}`);
  }
}
