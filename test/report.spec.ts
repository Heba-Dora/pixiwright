import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '../dist/index.js';

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, '..');

interface Attachment {
  name: string;
  contentType: string;
  path?: string;
  body?: string;
}

interface Report {
  suites: { specs: { title: string; tests: { results: { status: string; attachments: Attachment[]; errors: { message: string }[] }[] }[] }[] }[];
}

/** Runs real, deliberately failing tests in a child Playwright and reads its JSON report. */
async function runHarness(outputDir: string, args: string[] = []): Promise<Report> {
  const { stdout } = await run(
    join(ROOT, 'node_modules', '.bin', 'playwright'),
    ['test', '--config', 'test/harness/playwright.config.ts', '--reporter=json', ...args],
    { cwd: ROOT, env: { ...process.env, PIXIWRIGHT_HARNESS_OUTPUT: outputDir }, maxBuffer: 1 << 26 },
  ).catch((failure: { stdout: string }) => ({ stdout: failure.stdout }));
  return JSON.parse(stdout) as Report;
}

/** The JSON reporter inlines some attachments as base64 and leaves others on disk. */
async function bytesOf(attachment: Attachment | undefined): Promise<Buffer> {
  if (!attachment) throw new Error('attachment is missing');
  return attachment.body ? Buffer.from(attachment.body, 'base64') : readFile(attachment.path ?? '');
}

function result(report: Report, title: string) {
  const found = report.suites.flatMap((suite) => suite.specs).find((spec) => spec.title === title)?.tests[0]?.results[0];
  if (!found) throw new Error(`no result for ${title}`);
  return found;
}

test('a failing test gets the scene tree and a canvas image in its report', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const report = await runHarness(testInfo.outputPath('harness'), ['-g', 'fails on purpose']);
  const failed = result(report, 'fails on purpose');
  expect(failed.status).toBe('failed');
  expect(failed.errors[0]?.message).toContain('"ghost" has alpha = 0');

  const scene = failed.attachments.find((attachment) => attachment.name === 'pixi-scene');
  const canvas = failed.attachments.find((attachment) => attachment.name === 'pixi-canvas');
  expect(canvas?.contentType).toBe('image/png');
  expect(scene?.contentType).toBe('text/plain');

  expect((await bytesOf(scene)).toString()).toContain('Graphics "play"');
  expect((await bytesOf(canvas)).subarray(1, 4).toString()).toBe('PNG');
});

test('a passing test attaches nothing', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const report = await runHarness(testInfo.outputPath('harness'), ['-g', 'passes']);
  expect(result(report, 'passes').attachments.map((attachment) => attachment.name)).toEqual([]);
});

test('toMatchScene writes a missing file, then fails with a diff when the scene changes', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const output = testInfo.outputPath('harness');

  const created = await runHarness(output, ['-g', 'scene snapshot']);
  const first = result(created, 'scene snapshot');
  expect(first.status).toBe('failed');
  expect(first.errors[0]?.message).toContain('the current scene was written to');

  const compared = await runHarness(output, ['-g', 'scene snapshot']);
  expect(result(compared, 'scene snapshot').status).toBe('passed');

  const changed = await runHarness(output, ['-g', 'changed scene']);
  const failure = result(changed, 'changed scene');
  expect(failure.status).toBe('failed');
  expect(failure.errors[0]?.message).toContain('+ - Text "score": "Score: 1"');
  expect(failure.errors[0]?.message).toContain('- - Text "score": "Score: 0"');
});
