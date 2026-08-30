import { describe, expect, it } from 'vitest';
import { makeTestHarness } from './helpers.js';

describe('Battle Lab (Arena Evaluation Mode)', () => {
  it('runs the same task against three models and picks a winner', async () => {
    // non-zero latency scale so speed ordering is structural, not noise
    const h = await makeTestHarness({ simOptions: { latencyScale: 0.1, noFailures: true } });
    const report = await h.battleLab.run(
      'Create a landing page for my AI company with a pricing section and a REST API waitlist.',
      ['sim:obsidian', 'sim:atlas', 'sim:herald'],
    );
    expect(report.entries).toHaveLength(3);
    expect(report.winner).not.toBeNull();
    // winner has the highest combined score
    expect(report.entries[0].score).toBe(report.winner!.score);
    for (const e of report.entries.slice(1)) expect(e.score).toBeLessThanOrEqual(report.winner!.score);
    // obsidian (quality 96, all sections) should win the heuristic judge
    expect(report.winner!.catalogId).toBe('sim:obsidian');
    expect(report.block).toContain('WINNER');
    // observations feed back into intelligence
    expect(h.intelligence.observations('sim:obsidian').length).toBeGreaterThanOrEqual(1);
    // audit entry
    expect(h.audit.query({ tool: 'battle.run' }).length).toBe(1);
  }, 30000);

  it('reports unavailable models instead of crashing', async () => {
    const h = await makeTestHarness();
    const report = await h.battleLab.run('Build a small CLI tool.', ['arena:gpt-5.6', 'sim:atlas']);
    const arena = report.entries.find((e) => e.catalogId === 'arena:gpt-5.6');
    expect(arena?.success).toBe(false);
    expect(arena?.notes.join(' ')).toContain('not executable');
    expect(report.winner?.catalogId).toBe('sim:atlas');
  }, 30000);
});
