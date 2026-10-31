import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config.js';

const output = process.env.PIXIWRIGHT_HARNESS_OUTPUT ?? 'test-results/harness';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'failing.ts',
  fullyParallel: false,
  outputDir: join(output, 'results'),
  snapshotPathTemplate: join(output, 'scenes', '{arg}{ext}'),
});
