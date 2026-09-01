import { describe, expect, it } from 'vitest';
import { buildCatalog, ModelCatalog } from '../src/catalog.js';
import { ARENA_LEADERBOARD } from '../src/providers/arena/model-registry.js';

describe('ModelCatalog', () => {
  it('registers the Arena ecosystem for every leaderboard model', async () => {
    const catalog = await buildCatalog({ includeLocal: false });
    for (const entry of ARENA_LEADERBOARD) {
      const m = catalog.get(`arena:${entry.model}`);
      expect(m.provider).toBe('arena');
      expect(m.ranked).toBe(true);
      expect(m.signals.arenaRank).toBeGreaterThan(0);
      // no key in the test environment → not executable
      expect(m.available).toBe(false);
    }
  });

  it('namespaces direct provider models and marks them unavailable without keys', async () => {
    const catalog = await buildCatalog({ includeLocal: false });
    const gpt = catalog.get('openai:gpt-5.6');
    expect(gpt.provider).toBe('openai');
    expect(gpt.ranked).toBe(true);
    expect(gpt.available).toBe(false);
    const or = catalog.get('openrouter:deepseek/deepseek-v4');
    expect(or.provider).toBe('openrouter');
    expect(or.ranked).toBe(true);
  });

  it('sim models are always available and unracked', async () => {
    const catalog = await buildCatalog({ includeLocal: false });
    for (const m of catalog.list({ provider: 'sim' })) {
      expect(m.available).toBe(true);
      expect(m.ranked).toBe(false);
      expect(m.kind).toBe('simulated');
    }
  });

  it('routes catalog ids to the right adapter', async () => {
    const catalog = await buildCatalog({ includeLocal: false });
    expect(catalog.adapterFor('arena:claude-opus-4.5').provider).toBe('arena');
    expect(catalog.adapterFor('openai:gpt-5.6').provider).toBe('openai');
    expect(catalog.adapterFor('sim:atlas').provider).toBe('sim');
    expect(() => catalog.get('nope:nothing')).toThrow();
  });

  it('topRanked returns ranked models by rank order', async () => {
    const catalog = await buildCatalog({ includeLocal: false });
    const top = catalog.topRanked(3);
    expect(top[0].signals.arenaRank).toBe(1);
    expect(top[1].signals.arenaRank).toBe(2);
    expect(top[2].signals.arenaRank).toBe(3);
  });

  it('builds a custom adapter catalog entry for user-supplied endpoints', async () => {
    const catalog = new ModelCatalog();
    const adapter = await buildCatalog({ includeLocal: false, includeSim: false });
    void adapter;
    // register a custom adapter directly
    const { CustomAdapter } = await import('../src/providers/custom/adapter.js');
    const custom = new CustomAdapter({
      provider: 'myllm',
      adapterId: 'myllm',
      baseUrl: 'http://localhost:9999/v1',
      models: [{ model: 'llama-local', displayName: 'Llama Local', pricing: { inputPerM: 0, outputPerM: 0 }, contextLength: 8000 }],
      resolveApiKey: () => undefined,
    });
    catalog.registerAdapter(custom, [
      {
        catalogId: 'myllm:llama-local',
        provider: 'myllm',
        model: 'llama-local',
        displayName: 'Llama Local',
        kind: 'open-source',
        capabilities: { contextLength: 8000, vision: false, tools: true, structuredOutput: true, streaming: true },
        pricing: { inputPerM: 0, outputPerM: 0 },
        signals: {
          arenaRank: 0, agentSuccess: 80, toolReliability: 82, steerability: 80, coding: 80,
          reasoning: 79, bashRecovery: 78, toolHallucination: 12, speedSeconds: 1.0, costPerTask: 0, outputTokensPerTask: 800,
        },
        ranked: false,
        available: true,
      },
    ]);
    expect(catalog.has('myllm:llama-local')).toBe(true);
    expect(catalog.adapterFor('myllm:llama-local')).toBe(custom);
  });
});
