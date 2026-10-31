const DELAYS = [0, 20, 50, 100, 100, 250];

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Yields at least once, then on a backoff until the timeout runs out. */
export async function* attempts(timeout: number): AsyncGenerator<void> {
  const deadline = Date.now() + timeout;
  for (let attempt = 0; ; attempt++) {
    yield;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await sleep(Math.min(DELAYS[attempt] ?? 500, remaining));
  }
}
