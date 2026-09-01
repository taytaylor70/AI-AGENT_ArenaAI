/**
 * The unified model catalog.
 *
 * Merges every provider ecosystem into one addressable list:
 *   - `arena:*`        via the ArenaAdapter (Arena leaderboard models)
 *   - `openai:*`, `anthropic:*`, `google:*`, `mistral:*`, `groq:*`,
 *     `xai:*`, `openrouter:*` via their direct adapters
 *   - `sim:*`          offline deterministic models (dev/CI/demo)
 *   - `local:*`        Ollama models running on this machine
 *
 * Agents, the router and the Battle Lab only ever see `HarnessModel`
 * entries — never a concrete provider.
 */

import type { HarnessModel, LeaderboardSignals, ModelAdapter } from './types.js';
import { ARENA_LEADERBOARD, fetchArenaLeaderboard, type ArenaModelEntry } from './providers/arena/model-registry.js';
import { ArenaAdapter } from './providers/arena/adapter.js';
import { createOpenAIAdapter } from './providers/openai/adapter.js';
import { AnthropicAdapter } from './providers/anthropic/adapter.js';
import { createGoogleAdapter } from './providers/google/adapter.js';
import { createMistralAdapter } from './providers/mistral/adapter.js';
import { createGroqAdapter } from './providers/groq/adapter.js';
import { createXaiAdapter } from './providers/xai/adapter.js';
import { createOpenRouterAdapter } from './providers/openrouter/adapter.js';
import { CustomAdapter, SimulatedAdapter, SIM_MODELS } from './providers/custom/adapter.js';
import { OllamaAdapter } from './providers/local/ollama.js';

export interface CatalogOptions {
  arenaApiKey?: string;
  includeSim?: boolean;
  /** Options for the built-in simulated models (tests, demos). */
  simOptions?: { latencyScale?: number; noFailures?: boolean };
  includeLocal?: boolean;
  /** Fetch a live Arena leaderboard snapshot (falls back to bundled). */
  refreshLeaderboard?: boolean;
  fetchImpl?: typeof fetch;
  /** Extra custom adapters to register. */
  customAdapters?: CustomAdapter[];
  localModels?: string[];
}

const FALLBACK_SIGNALS: LeaderboardSignals = {
  arenaRank: 0,
  agentSuccess: 85, toolReliability: 86, steerability: 84,
  coding: 85, reasoning: 84, bashRecovery: 80, toolHallucination: 10,
  speedSeconds: 1.5, costPerTask: 0.1, outputTokensPerTask: 1200,
};

export class ModelCatalog {
  readonly models = new Map<string, HarnessModel>();
  readonly adapters = new Map<string, ModelAdapter>();

  registerAdapter(adapter: ModelAdapter, entries: HarnessModel[]): void {
    this.adapters.set(adapter.provider, adapter);
    for (const e of entries) this.models.set(e.catalogId, e);
  }

  get(catalogId: string): HarnessModel {
    const m = this.models.get(catalogId);
    if (!m) throw new Error(`ModelCatalog: unknown catalog id "${catalogId}"`);
    return m;
  }

  has(catalogId: string): boolean {
    return this.models.has(catalogId);
  }

  adapterFor(catalogId: string): ModelAdapter {
    const m = this.get(catalogId);
    const a = this.adapters.get(m.provider);
    if (!a) throw new Error(`ModelCatalog: no adapter registered for provider "${m.provider}"`);
    return a;
  }

  list(filter?: { provider?: string; ranked?: boolean; available?: boolean; kind?: HarnessModel['kind'] }): HarnessModel[] {
    let out = [...this.models.values()];
    if (filter?.provider) out = out.filter((m) => m.provider === filter.provider);
    if (filter?.ranked !== undefined) out = out.filter((m) => m.ranked === filter.ranked);
    if (filter?.available !== undefined) out = out.filter((m) => m.available === filter.available);
    if (filter?.kind) out = out.filter((m) => m.kind === filter.kind);
    return out.sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  }

  available(): HarnessModel[] {
    return this.list({ available: true });
  }

  /**
   * Top N by arena rank (ranked models only). The same underlying model can
   * be reachable via multiple paths (arena: gpt-5.6 vs openai:gpt-5.6);
   * the list dedupes to one entry per native model id.
   */
  topRanked(n = 5): HarnessModel[] {
    const seen = new Set<string>();
    const out: HarnessModel[] = [];
    // Ties on rank (same model via arena vs a direct provider): prefer the
    // Arena path — this is the Arena leaderboard view.
    const providerPref = (m: HarnessModel): number => (m.provider === 'arena' ? 0 : 1);
    for (const m of this.list({ ranked: true }).sort(
      (a, b) =>
        a.signals.arenaRank - b.signals.arenaRank ||
        providerPref(a) - providerPref(b) ||
        a.catalogId.localeCompare(b.catalogId),
    )) {
      if (seen.has(m.model)) continue;
      seen.add(m.model);
      out.push(m);
      if (out.length === n) break;
    }
    return out;
  }
}

function arenaEntries(entries: ArenaModelEntry[], key: string | undefined): HarnessModel[] {
  return entries.map((e) => ({
    catalogId: `arena:${e.model}`,
    provider: 'arena',
    model: e.model,
    displayName: e.displayName,
    kind: e.kind,
    capabilities: e.capabilities,
    pricing: e.pricing,
    signals: e.signals,
    ranked: e.signals.arenaRank > 0,
    available: Boolean(key),
    notes: 'Served via the Arena adapter (Arena is one model ecosystem among many).',
  }));
}

function simSignals(quality: number, failureRate: number, speedSeconds: number, pricing: { inputPerM: number; outputPerM: number }): LeaderboardSignals {
  const typicalIn = 2500;
  const typicalOut = 1600;
  const costPerTask = (typicalIn / 1e6) * pricing.inputPerM + (typicalOut / 1e6) * pricing.outputPerM;
  return {
    arenaRank: 0,
    agentSuccess: quality,
    toolReliability: Math.max(0, 100 - failureRate * 100),
    steerability: quality - 2,
    coding: quality,
    reasoning: quality - 1,
    bashRecovery: quality - 6,
    toolHallucination: failureRate * 100 * 0.6,
    speedSeconds,
    costPerTask,
    outputTokensPerTask: 1600,
  };
}

export async function buildCatalog(opts: CatalogOptions = {}): Promise<ModelCatalog> {
  const catalog = new ModelCatalog();
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const arenaKey = opts.arenaApiKey ?? process.env.TDX_ARENA_API_KEY;
  const entries = opts.refreshLeaderboard ? await fetchArenaLeaderboard(fetchImpl) : ARENA_LEADERBOARD;

  /* Arena ecosystem */
  const arenaAdapter = new ArenaAdapter({ apiKey: arenaKey, models: entries, fetchImpl });
  catalog.registerAdapter(arenaAdapter, arenaEntries(entries, arenaKey));

  /* Direct providers (available only when a key exists) */
  const openai = createOpenAIAdapter({ fetchImpl });
  catalog.registerAdapter(openai, openai.models.map((model) => directEntry('openai', model, openai, entries)));
  const anthropic = new AnthropicAdapter({ fetchImpl });
  catalog.registerAdapter(anthropic, anthropic.models.map((model) => directEntry('anthropic', model, anthropic, entries)));
  const google = createGoogleAdapter({ fetchImpl });
  catalog.registerAdapter(google, google.models.map((model) => directEntry('google', model, google, entries)));
  const mistral = createMistralAdapter({ fetchImpl });
  catalog.registerAdapter(mistral, mistral.models.map((model) => directEntry('mistral', model, mistral, entries)));
  const groq = createGroqAdapter({ fetchImpl });
  catalog.registerAdapter(groq, groq.models.map((model) => directEntry('groq', model, groq, entries)));
  const xai = createXaiAdapter({ fetchImpl });
  catalog.registerAdapter(xai, xai.models.map((model) => directEntry('xai', model, xai, entries)));
  const openrouter = createOpenRouterAdapter({ fetchImpl });
  catalog.registerAdapter(openrouter, openrouter.models.map((model) => directEntry('openrouter', model, openrouter, entries)));

  for (const extra of opts.customAdapters ?? []) {
    catalog.registerAdapter(extra, extra.models.map((model) => directEntry(extra.provider, model, extra, entries)));
  }

  /* Simulated models — always available, offline */
  if (opts.includeSim !== false) {
    const sim = new SimulatedAdapter(opts.simOptions ?? {});
    const entries2 = SIM_MODELS.map((p) => ({
      catalogId: `sim:${p.model}`,
      provider: 'sim',
      model: p.model,
      displayName: p.displayName,
      kind: 'simulated' as const,
      capabilities: { contextLength: p.contextLength, vision: true, tools: true, structuredOutput: true, streaming: true },
      pricing: p.pricing,
      signals: simSignals(p.quality, p.toolFailureRate, p.speedSeconds, p.pricing),
      ranked: false,
      available: true,
      notes: 'Offline deterministic model — proves the full agent loop without network or keys.',
    }));
    catalog.registerAdapter(sim, entries2);
  }

  /* Local models — available when an Ollama runtime answers */
  if (opts.includeLocal !== false) {
    const local = new OllamaAdapter({ models: opts.localModels, fetchImpl });
    const up = await local.ping();
    catalog.registerAdapter(local, local.models.map((model) => ({
      catalogId: `local:${model}`,
      provider: 'local',
      model,
      displayName: `Ollama ${model}`,
      kind: 'open-source' as const,
      capabilities: local.capabilities,
      pricing: { inputPerM: 0, outputPerM: 0 },
      signals: { ...FALLBACK_SIGNALS, costPerTask: 0, speedSeconds: 2.5, arenaRank: 0 },
      ranked: false,
      available: up,
      notes: 'Runs on this machine via Ollama.',
    })));
  }

  return catalog;
}

function directEntry(
  provider: string,
  model: string,
  adapter: ModelAdapter,
  arenaEntries: ArenaModelEntry[],
): HarnessModel {
  const arena = arenaEntries.find((e) => e.sourceProvider === provider && e.model === model)
    ?? (model.includes('/')
      ? arenaEntries.find((e) => {
          const [p, m] = model.split('/');
          return e.sourceProvider === p && e.model === m;
        })
      : undefined);
  return {
    catalogId: `${provider}:${model}`,
    provider,
    model,
    displayName: arena?.displayName ?? model,
    kind: arena?.kind ?? 'proprietary',
    capabilities: arena?.capabilities ?? adapter.capabilities,
    pricing: arena?.pricing ?? { inputPerM: 1, outputPerM: 4 },
    signals: arena?.signals ?? { ...FALLBACK_SIGNALS },
    ranked: arena !== undefined,
    available: adapterConfigured(adapter),
    notes: `Direct ${provider} API path.`,
  };
}

function adapterConfigured(adapter: ModelAdapter): boolean {
  const a = adapter as unknown as { configured?: boolean };
  return a.configured !== false;
}
