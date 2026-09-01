import { describe, expect, it } from 'vitest';
import { makeTestHarness } from './helpers.js';

describe('ModelIntelligence', () => {
  it('starts from leaderboard signals with no observations', async () => {
    const h = await makeTestHarness();
    const p = h.intelligence.profile('sim:atlas');
    expect(p.observations).toBe(0);
    expect(p.signals.speedSeconds).toBeCloseTo(0.4, 5);
  });

  it('blends local observations once enough accumulate', async () => {
    const h = await makeTestHarness();
    const base = h.intelligence.profile('sim:atlas').signals;
    for (let i = 0; i < 5; i++) {
      h.intelligence.recordObservation({
        catalogId: 'sim:atlas',
        latencyMs: 900, // much slower than leaderboard's 0.4s
        success: true,
        toolCalls: 2,
        toolFailures: 0,
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        at: Date.now(),
      });
    }
    const p = h.intelligence.profile('sim:atlas');
    expect(p.observations).toBe(5);
    expect(p.signals.speedSeconds).toBeGreaterThan(base.speedSeconds);
    expect(p.signals.speedSeconds).toBeLessThan(1.0);
  });

  it('exposes raw observations for arena-metric projection', async () => {
    const h = await makeTestHarness();
    h.intelligence.recordObservation({
      catalogId: 'sim:herald', latencyMs: 10, success: false, toolCalls: 1, toolFailures: 1,
      inputTokens: 100, outputTokens: 50, costUsd: 0.001, at: Date.now(),
    });
    const obs = h.intelligence.observations('sim:herald');
    expect(obs).toHaveLength(1);
    expect(obs[0].success).toBe(false);
  });

  it('renders the model intelligence card with all signals', async () => {
    const h = await makeTestHarness();
    const card = h.intelligence.card('arena:claude-sonnet-4.5');
    for (const line of ['Arena Rank', 'Agent Success', 'Tool Reliability', 'Steerability', 'Coding', 'Reasoning', 'Speed', 'Estimated Cost', 'Context', 'Vision', 'Tools', 'Structured Output']) {
      expect(card).toContain(line);
    }
    expect(card).toContain('#5');
    expect(card).toContain('$0.42/task');
    expect(card).toContain('1.8s');
  });
});
