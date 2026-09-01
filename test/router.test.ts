import { describe, expect, it } from 'vitest';
import { makeTestHarness } from './helpers.js';
import { createTask } from '../src/core/task-engine/task.js';

const codingTask = () =>
  createTask('Build a production-ready SaaS application with a REST API, database and landing page.');
const quickTask = () => createTask('Quick question: what is the best HTTP status code for a cache hit?');

const coderRole = { id: 'coder', needsTools: true };
const writerRole = { id: 'strategist', needsTools: false };

describe('ModelRouter', () => {
  it('fast strategy picks the lowest-latency eligible model', async () => {
    const h = await makeTestHarness();
    const sel = h.router.select(quickTask(), writerRole, 'fast');
    const fastest = h.intelligence.profile(sel.catalogId).signals.speedSeconds;
    for (const c of sel.candidates) {
      const s = h.intelligence.profile(c.catalogId).signals.speedSeconds;
      expect(fastest).toBeLessThanOrEqual(s + 1e-9);
    }
  });

  it('cheap strategy picks the lowest-cost eligible model', async () => {
    const h = await makeTestHarness();
    const sel = h.router.select(quickTask(), writerRole, 'cheap');
    const cost = h.intelligence.profile(sel.catalogId).signals.costPerTask;
    expect(cost).toBeLessThanOrEqual(0.02);
  });

  it('best strategy favors the strongest agent-quality eligible model', async () => {
    const h = await makeTestHarness();
    const sel = h.router.select(codingTask(), coderRole, 'best');
    const profile = h.intelligence.profile(sel.catalogId);
    // among sim models, obsidian is the strongest
    expect(sel.catalogId).toBe('sim:obsidian');
    expect(profile.signals.agentSuccess).toBeGreaterThanOrEqual(90);
  });

  it('arena-champion requires ranked models and picks rank #1 when availability is relaxed', async () => {
    const h = await makeTestHarness();
    const sel = h.intelRouter.select(codingTask(), coderRole, 'arena-champion');
    // rank #1 is Claude Opus 4.5 — reachable via the Arena path or the
    // direct Anthropic path (same underlying model, same signals)
    expect(sel.catalogId.endsWith('claude-opus-4.5')).toBe(true);
    expect(h.catalog.get(sel.catalogId).signals.arenaRank).toBe(1);
    expect(sel.effectiveStrategy).toBe('arena-champion');
  });

  it('arena-champion on the availability router falls back to ranked+available (here: error-free sim set)', async () => {
    const h = await makeTestHarness();
    // no ranked model is available without keys, but sim models have rank 0;
    // the champion score for unranked models is quality-only, so it must still resolve
    const sel = h.router.select(codingTask(), coderRole, 'arena-champion');
    expect(sel.catalogId.startsWith('sim:')).toBe(true);
  });

  it('auto strategy: coding+architecture tasks resolve to best', async () => {
    const h = await makeTestHarness();
    const sel = h.router.select(codingTask(), coderRole, 'auto');
    expect(sel.effectiveStrategy).toBe('best');
  });

  it('auto strategy: pure research/quick tasks resolve to fast', async () => {
    const h = await makeTestHarness();
    const t = createTask('Research and compare the top vector databases. Quick summary please.');
    const sel = h.router.select(t, { id: 'researcher', needsTools: true }, 'auto');
    expect(sel.effectiveStrategy).toBe('fast');
  });

  it('capability filter: tool-requiring roles never get a no-tools model', async () => {
    const h = await makeTestHarness();
    const t = createTask('Build a landing page with a pricing table and a REST API.');
    const sel = h.router.select(t, { id: 'coder', needsTools: true, contextHintTokens: 50000 }, 'balanced');
    const model = h.catalog.get(sel.catalogId);
    expect(model.capabilities.tools).toBe(true);
    expect(model.capabilities.contextLength).toBeGreaterThanOrEqual(100_000);
  });

  it('excludes unavailable models by default', async () => {
    const h = await makeTestHarness();
    const sel = h.router.select(quickTask(), writerRole, 'fast');
    expect(h.catalog.get(sel.catalogId).available).toBe(true);
  });

  it('rationale names the winner and the runner-up', async () => {
    const h = await makeTestHarness();
    const sel = h.router.select(quickTask(), writerRole, 'balanced');
    expect(sel.rationale).toContain(sel.catalogId);
    expect(sel.candidates.length).toBeGreaterThanOrEqual(2);
    expect(sel.candidates[0].score).toBeGreaterThanOrEqual(sel.candidates[1].score);
  });
});
