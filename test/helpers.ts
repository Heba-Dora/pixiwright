import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Page } from '@playwright/test';

// HTTPS because browsers only offer WebGPU in a secure context.
const ORIGIN = 'https://pixiwright.test';
const FIXTURES = join(import.meta.dirname, 'fixtures');
const PIXI_DIST = join(import.meta.dirname, '..', 'node_modules', 'pixi.js', 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.mjs': 'text/javascript' };

/** Serves the fixture app from memory, so tests need no server or port. */
export async function serve(page: Page, { minified = false } = {}): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    const path = pathname === '/pixi.mjs' ? join(PIXI_DIST, minified ? 'pixi.min.mjs' : 'pixi.mjs') : join(FIXTURES, pathname);
    const body = await readFile(path).catch(() => null);
    if (!body) return route.fulfill({ status: 404 });
    return route.fulfill({ body, contentType: TYPES[extname(path)] ?? 'application/octet-stream' });
  });
}

export async function openApp(page: Page, query = '', options: { minified?: boolean } = {}): Promise<void> {
  await serve(page, options);
  await page.goto(`${ORIGIN}/index.html${query}`);
}

export async function openBlank(page: Page): Promise<void> {
  await serve(page);
  await page.goto(`${ORIGIN}/blank.html`);
}

export function taps(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { taps: string[] }).taps);
}
