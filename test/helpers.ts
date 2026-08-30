import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarness, type Harness } from '../src/harness.js';

export function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'tdx-test-'));
}

/** Deterministic, instant harness for tests (no tool failures, zero latency). */
export async function makeTestHarness(extra: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  return createHarness({
    workspaceRoot: tmpWorkspace(),
    online: false,
    simOptions: { latencyScale: 0, noFailures: true },
    ...extra,
  });
}
