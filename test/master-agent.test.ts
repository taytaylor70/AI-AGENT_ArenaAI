import { describe, expect, it } from 'vitest';
import { makeTestHarness } from './helpers.js';

const TASK =
  'Build me a production-ready SaaS application: a landing page with a pricing table, ' +
  'a Node.js REST API, and a SQLite-backed user store with auth.';

describe('MasterAgent orchestration', () => {
  it('runs the full multi-agent pipeline and produces a scorecard', async () => {
    const h = await makeTestHarness();
    const report = await h.run(TASK);

    // every planned role executed
    const roles = new Set([...report.results.values()].map((r) => r.role));
    expect(roles.has('strategist')).toBe(true);
    expect(roles.has('coder')).toBe(true);
    expect(roles.has('reviewer')).toBe(true);
    expect(roles.has('qa')).toBe(true);

    // every step succeeded with the deterministic sim models
    for (const [, r] of report.results) expect(r.success).toBe(true);

    // final output carries the artifact sections
    expect(report.finalOutput).toContain('Implementation');
    expect(report.finalOutput).toContain('Review');
    expect(report.finalOutput).toContain('QA');
    expect(report.finalOutput).toContain('APPROVED');

    // scorecard is shaped like the product definition
    expect(report.scorecard.total).toBeGreaterThan(80);
    expect(report.scorecard.block).toContain('TDX SCORE');
    expect(report.scorecard.block).toContain('TOTAL');
    expect(report.scorecard.block).toContain('Task Success');

    // routing decisions used different models per role when strategies differed,
    // and every run recorded cost + latency
    expect(report.totalCostUsd).toBeGreaterThan(0);
    expect(report.totalLatencyMs).toBeGreaterThan(0);

    // durable learning stored in long-term memory
    expect(h.memory.longTerm.size).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('performs the reviewer → coder → reviewer revision loop with a weak model', async () => {
    // cheap strategy → sim:herald (quality 76) → strict first-pass CHANGES →
    // one revision round → approval on re-review
    const h = await makeTestHarness({ strategy: 'cheap' });
    const report = await h.run(TASK);
    expect(report.results.has('implement-revision-1')).toBe(true);
    const review = report.results.get('review');
    expect(review?.content.startsWith('APPROVED')).toBe(true);
    const revision = report.results.get('implement-revision-1');
    expect(revision?.objective).toContain('Revision 1');
  }, 30000);

  it('audits the whole run including the run.complete entry', async () => {
    const h = await makeTestHarness();
    await h.run('Write a short marketing email for our AI company.');
    const done = h.audit.query({ tool: 'run.complete' });
    expect(done.length).toBe(1);
    expect(done[0].status).toContain('TDX');
  });
});
