import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeTdxScore, renderTdxScore, compareWithArena } from '../src/evaluation/scorecard.js';
import { RegressionGuard } from '../src/evaluation/regression/regression.js';
import { toArenaMetrics, renderArenaMetrics } from '../src/evaluation/arena-metrics/arena-metrics.js';
import { HeuristicJudge, ModelJudge } from '../src/evaluation/model-comparison/judge.js';
import { SimulatedAdapter } from '../src/providers/custom/adapter.js';

const baseInput = {
  taskSuccess: 96, reasoning: 94, toolReliability: 98, codeQuality: 95,
  recovery: 91, steerability: 97, efficiency: 89, cost: 93,
};

describe('TDX scorecard', () => {
  it('computes the weighted total from the product definition example', () => {
    const card = computeTdxScore(baseInput);
    // 0.2*96 + 0.1*94 + 0.15*98 + 0.15*95 + 0.1*91 + 0.1*97 + 0.1*89 + 0.1*93
    expect(card.total).toBeCloseTo(94.6, 1);
    const block = renderTdxScore(card);
    expect(block).toContain('TDX SCORE');
    expect(block).toContain('Task Success');
    expect(block).toContain('TOTAL');
    expect(block).toMatch(/94\.\d/);
  });

  it('clamps out-of-range inputs', () => {
    const card = computeTdxScore({ ...baseInput, taskSuccess: 150, cost: -20 });
    expect(card.total).toBeLessThanOrEqual(100);
  });

  it('compares against Arena signals', () => {
    const card = computeTdxScore(baseInput);
    const cmp = compareWithArena(card, {
      agentSuccess: 93.8, toolReliability: 96.9, steerability: 94.6, coding: 97.1, reasoning: 94.5, bashRecovery: 93.2,
    });
    expect(cmp).toContain('TDX vs Arena');
    expect(cmp).toContain('+');
  });
});

describe('Regression guard', () => {
  it('new task → new-baseline, stable rerun → pass, degraded run → regression', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tdx-reg-'));
    const guard = new RegressionGuard(join(dir, 'baseline.json'), 2);
    const card = computeTdxScore(baseInput);

    expect(guard.evaluate('t1', card).verdict).toBe('new-baseline');
    guard.save('t1', card);

    expect(guard.evaluate('t1', card).verdict).toBe('pass');

    const degraded = computeTdxScore({ ...baseInput, codeQuality: 80, taskSuccess: 85 });
    const report = guard.evaluate('t1', degraded);
    expect(report.verdict).toBe('regression');
    expect(report.regressed.some((r) => r.metric === 'codeQuality')).toBe(true);
    expect(guard.renderReport(report)).toContain('REGRESSED');

    // persists across instances
    const guard2 = new RegressionGuard(join(dir, 'baseline.json'), 2);
    expect(guard2.getBaseline('t1')?.total).toBe(card.total);
  });
});

describe('Arena metrics projection', () => {
  it('projects observations onto the Arena metric set', () => {
    const m = toArenaMetrics([
      { catalogId: 'x', latencyMs: 100, success: true, toolCalls: 4, toolFailures: 0, inputTokens: 100, outputTokens: 800, costUsd: 0.04, at: 0 },
      { catalogId: 'x', latencyMs: 300, success: false, toolCalls: 2, toolFailures: 1, inputTokens: 100, outputTokens: 600, costUsd: 0.02, at: 1 },
    ]);
    expect(m.confirmedSuccess).toBeCloseTo(50, 5);
    // 1 failure / 6 tool calls
    expect(m.toolHallucination).toBeCloseTo(100 / 6, 5);
    expect(m.costPerTask).toBeCloseTo(0.03, 5);
    expect(renderArenaMetrics(m)).toContain('Confirmed success');
  });
});

describe('Judges', () => {
  it('heuristic judge rewards complete artifacts and penalizes missing sections', () => {
    const j = new HeuristicJudge();
    const good = j.judge(
      'Build a SaaS landing page with pricing and a REST API',
      { coding: true, ui: true, database: false, architecture: false, research: false, writing: false, data: false, security: false },
      'Implementation complete\n- pricing table built\n- API contract defined\n- page assembled',
      0, true,
    );
    const bad = j.judge(
      'Build a SaaS landing page with pricing and a REST API',
      { coding: true, ui: true, database: false, architecture: false, research: false, writing: false, data: false, security: false },
      'done.', 1, false,
    );
    expect(good.quality).toBeGreaterThan(bad.quality);
    expect(bad.notes.join(' ')).toContain('missing expected sections');
  });

  it('model judge parses SCORE from any adapter', async () => {
    const sim = new SimulatedAdapter({ models: [{ model: 'judge', displayName: 'Judge', quality: 90, speedSeconds: 0.1, toolFailureRate: 0, pricing: { inputPerM: 1, outputPerM: 1 }, contextLength: 8000 }] });
    const mj = new ModelJudge(sim, 'judge');
    const res = await mj.judge('make a thing', 'a thing was made');
    expect(res.quality).toBe(50); // sim doesn't emit SCORE → neutral fallback
    expect(res.notes.length).toBeGreaterThan(0);
  });
});
