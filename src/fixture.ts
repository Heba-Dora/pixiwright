import { test as base } from '@playwright/test';
import { installAgent } from './agent.js';
import { attachPixiState, connectPixi, type ClockMode, type Pixi } from './pixi.js';

export interface PixiFixtures {
  pixi: Pixi;
  /** Set to 'frozen' with test.use() to stop the clock as each app starts. */
  pixiClock: ClockMode;
}

export const test = base.extend<PixiFixtures>({
  pixiClock: ['real', { option: true }],
  // Installed on the context so it is in place even when a beforeEach opens the page before `pixi` is set up.
  context: async ({ context, pixiClock }, use) => {
    await context.addInitScript(installAgent, { freeze: pixiClock === 'frozen' });
    await use(context);
  },
  pixi: async ({ page, pixiClock }, use, testInfo) => {
    const pixi = await connectPixi(page, { clock: pixiClock });
    await use(pixi);
    if (testInfo.status !== testInfo.expectedStatus) {
      // The test's own failure is what matters; a closed page must not replace it.
      await attachPixiState(pixi, testInfo).catch(() => {});
    }
  },
});
