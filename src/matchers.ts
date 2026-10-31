import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect as baseExpect, test as baseTest } from '@playwright/test';
import { PixiLocator } from './locator.js';
import type { Pixi } from './pixi.js';
import { attempts } from './poll.js';
import type { SceneOptions } from './types.js';

interface Check {
  pass: boolean;
  received: string;
}

interface TimeoutOption {
  timeout?: number;
}

/** Keeps DOM assertions working for tests that import expect from here. */
async function delegate(isNot: boolean, name: string, received: unknown, args: unknown[]) {
  const target = (isNot ? baseExpect(received).not : baseExpect(received)) as unknown as Record<string, (...input: unknown[]) => Promise<void>>;
  try {
    await target[name]!(...args);
    return { pass: !isNot, message: () => '' };
  } catch (error) {
    return { pass: isNot, message: () => (error as Error).message };
  }
}

async function settle(isNot: boolean, timeout: number, check: () => Promise<Check | undefined>): Promise<Check> {
  let last: Check = { pass: false, received: 'the page kept navigating' };
  for await (const _ of attempts(timeout)) {
    last = (await check()) ?? last;
    if (last.pass !== isNot) break;
  }
  return last;
}

function report(locator: PixiLocator, matcher: string, isNot: boolean, expected: string, timeout: number, result: Check) {
  return {
    pass: result.pass,
    name: matcher,
    expected,
    actual: result.received,
    message: () =>
      [
        `expect(${locator})${isNot ? '.not' : ''}.${matcher}() failed`,
        '',
        `Expected: ${isNot ? 'not ' : ''}${expected}`,
        `Received: ${result.received}`,
        `Timeout: ${timeout}ms`,
      ].join('\n'),
  };
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function textMatches(actual: string | null, expected: string | RegExp): boolean {
  if (actual === null) return false;
  return typeof expected === 'string' ? normalize(actual) === normalize(expected) : expected.test(actual);
}

function lineDiff(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const removed = expectedLines.filter((line) => !actualLines.includes(line)).map((line) => `- ${line}`);
  const added = actualLines.filter((line) => !expectedLines.includes(line)).map((line) => `+ ${line}`);
  return [...removed, ...added].join('\n');
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export const expect = baseExpect.extend({
  async toBeVisible(received: unknown, options: TimeoutOption = {}) {
    if (!(received instanceof PixiLocator)) return delegate(this.isNot, 'toBeVisible', received, [options]);
    const locator = received;
    const timeout = options.timeout ?? this.timeout;
    const result = await settle(this.isNot, timeout, async () => {
      const found = await locator.single();
      if (found === undefined) return undefined;
      if (found === null) return { pass: false, received: 'no matching object in the scene' };
      return { pass: found.visible, received: found.visible ? 'visible' : `hidden: ${found.hiddenReason}` };
    });
    return report(locator, 'toBeVisible', this.isNot, 'visible', timeout, result);
  },

  async toHaveText(received: unknown, expected: string | RegExp, options: TimeoutOption = {}) {
    if (!(received instanceof PixiLocator)) return delegate(this.isNot, 'toHaveText', received, [expected, options]);
    const locator = received;
    const timeout = options.timeout ?? this.timeout;
    const result = await settle(this.isNot, timeout, async () => {
      const found = await locator.single();
      if (found === undefined) return undefined;
      if (found === null) return { pass: false, received: 'no matching object in the scene' };
      return { pass: textMatches(found.text, expected), received: found.text === null ? 'no text' : JSON.stringify(found.text) };
    });
    return report(locator, 'toHaveText', this.isNot, `text ${expected instanceof RegExp ? expected : JSON.stringify(expected)}`, timeout, result);
  },

  async toHaveCount(received: unknown, expected: number, options: TimeoutOption = {}) {
    if (!(received instanceof PixiLocator)) return delegate(this.isNot, 'toHaveCount', received, [expected, options]);
    const locator = received;
    const timeout = options.timeout ?? this.timeout;
    const result = await settle(this.isNot, timeout, async () => {
      const count = await locator.pixi.attempt('count', locator.query);
      return count === undefined ? undefined : { pass: count === expected, received: String(count) };
    });
    return report(locator, 'toHaveCount', this.isNot, String(expected), timeout, result);
  },

  /** Compares the scene tree with a stored text file, retrying until it matches or times out. */
  async toMatchScene(received: Pixi, name: string, options: SceneOptions & TimeoutOption = {}) {
    if (this.isNot) throw new Error('toMatchScene does not support .not');
    const { timeout: timeoutOption, ...sceneOptions } = options;
    const timeout = timeoutOption ?? this.timeout;
    const info = baseTest.info();
    const path = info.snapshotPath(name);
    const update = info.config.updateSnapshots;
    const stored = await readFile(path, 'utf8').catch(() => null);

    if (stored === null) {
      const scene = await received.scene(sceneOptions);
      if (update === 'none') return { pass: false, message: () => `Scene snapshot is missing: ${path}` };
      await write(path, `${scene}\n`);
      // At runtime the unset value is 'default', which is not in Playwright's types.
      const accepted = update === 'all' || update === 'changed';
      return { pass: accepted, message: () => `Scene snapshot did not exist, so the current scene was written to ${path}. Check it and run the test again.` };
    }

    const expected = stored.replace(/\n$/, '');
    let actual = '';
    for await (const _ of attempts(timeout)) {
      actual = await received.scene(sceneOptions);
      if (actual === expected) return { pass: true, message: () => '' };
    }
    if (update === 'all' || update === 'changed') {
      await write(path, `${actual}\n`);
      return { pass: true, message: () => '' };
    }

    await info.attach(`${name}-expected`, { body: stored, contentType: 'text/plain' });
    await info.attach(`${name}-actual`, { body: `${actual}\n`, contentType: 'text/plain' });
    return {
      pass: false,
      name: 'toMatchScene',
      expected,
      actual,
      message: () => `Scene does not match ${path}\nTimeout: ${timeout}ms\n\n${lineDiff(expected, actual)}`,
    };
  },
});
