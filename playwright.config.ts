import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  snapshotPathTemplate: '{testDir}/__scenes__/{testFileName}/{arg}{ext}',
  use: {
    // Local runs use the installed Chrome; CI installs Playwright's Chromium.
    ...(process.env.CI ? {} : { channel: 'chrome' }),
    viewport: { width: 1000, height: 700 },
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-webgpu',
        '--use-webgpu-adapter=swiftshader',
      ],
    },
  },
});
