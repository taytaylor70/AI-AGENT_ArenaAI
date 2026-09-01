/**
 * Arena compatibility layer — model registry.
 *
 * A snapshot of the Arena model ecosystem: the text leaderboard lists
 * hundreds of publicly available models and the Agent Arena evaluates
 * dozens of agent-capable ones. This file bundles a representative
 * snapshot (one entry per model the harness ships with) with the
 * signals the Agent Arena exposes:
 *
 *   confirmed success, steerability, bash recovery, tool hallucination,
 *   cost/task, output tokens/task — plus rank, speed and capability flags.
 *
 * `fetchArenaLeaderboard()` can pull a fresh snapshot from a live Arena
 * endpoint (set TDX_ARENA_API); when unreachable, the bundled snapshot
 * is used so the harness remains fully functional offline.
 */

import type { LeaderboardSignals, ModelCapabilities } from '../../types.js';

export interface ArenaModelEntry {
  /** Provider that owns the model (source of truth for direct APIs). */
  sourceProvider: string;
  /** Provider-native model id. */
  model: string;
  displayName: string;
  kind: 'proprietary' | 'open-source' | 'hybrid';
  capabilities: ModelCapabilities;
  /** USD per 1M tokens. */
  pricing: { inputPerM: number; outputPerM: number };
  signals: LeaderboardSignals;
}

/** Default Arena API base (override with TDX_ARENA_API). */
export const ARENA_API_BASE = process.env.TDX_ARENA_API ?? 'https://api.arena.ai';

const cap = (
  contextLength: number,
  flags: { vision?: boolean; tools?: boolean; structured?: boolean },
): ModelCapabilities => ({
  contextLength,
  vision: flags.vision ?? false,
  tools: flags.tools ?? false,
  structuredOutput: flags.structured ?? false,
  streaming: true,
});

/**
 * Bundled Arena leaderboard snapshot.
 * Values are a representative sample for development and are refreshed
 * from the live Arena endpoint when one is configured.
 */
export const ARENA_LEADERBOARD: ArenaModelEntry[] = [
  {
    sourceProvider: 'anthropic',
    model: 'claude-opus-4.5',
    displayName: 'Claude Opus 4.5',
    kind: 'proprietary',
    capabilities: cap(1_000_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 5, outputPerM: 25 },
    signals: {
      arenaRank: 1, agentSuccess: 96.1, toolReliability: 97.8, steerability: 95.2,
      coding: 97.1, reasoning: 98.3, bashRecovery: 95.4, toolHallucination: 3.1,
      speedSeconds: 3.2, costPerTask: 1.24, outputTokensPerTask: 2400,
    },
  },
  {
    sourceProvider: 'openai',
    model: 'gpt-5.6',
    displayName: 'GPT-5.6',
    kind: 'proprietary',
    capabilities: cap(400_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 3, outputPerM: 15 },
    signals: {
      arenaRank: 2, agentSuccess: 95.4, toolReliability: 98.2, steerability: 94.1,
      coding: 96.8, reasoning: 97.5, bashRecovery: 94.8, toolHallucination: 2.6,
      speedSeconds: 2.6, costPerTask: 0.98, outputTokensPerTask: 2100,
    },
  },
  {
    sourceProvider: 'google',
    model: 'gemini-3-ultra',
    displayName: 'Gemini 3 Ultra',
    kind: 'proprietary',
    capabilities: cap(1_000_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 2.5, outputPerM: 12.5 },
    signals: {
      arenaRank: 3, agentSuccess: 94.7, toolReliability: 96.5, steerability: 93.0,
      coding: 95.9, reasoning: 97.1, bashRecovery: 92.7, toolHallucination: 3.8,
      speedSeconds: 2.9, costPerTask: 0.86, outputTokensPerTask: 2300,
    },
  },
  {
    sourceProvider: 'xai',
    model: 'grok-4.1',
    displayName: 'Grok 4.1',
    kind: 'proprietary',
    capabilities: cap(256_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 3, outputPerM: 15 },
    signals: {
      arenaRank: 4, agentSuccess: 92.3, toolReliability: 95.1, steerability: 93.8,
      coding: 94.2, reasoning: 93.6, bashRecovery: 91.9, toolHallucination: 4.9,
      speedSeconds: 2.2, costPerTask: 0.61, outputTokensPerTask: 1900,
    },
  },
  {
    sourceProvider: 'anthropic',
    model: 'claude-sonnet-4.5',
    displayName: 'Claude Sonnet 4.5',
    kind: 'proprietary',
    capabilities: cap(1_000_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 3, outputPerM: 15 },
    signals: {
      arenaRank: 5, agentSuccess: 93.8, toolReliability: 96.9, steerability: 94.6,
      coding: 97.1, reasoning: 94.5, bashRecovery: 93.2, toolHallucination: 3.4,
      speedSeconds: 1.8, costPerTask: 0.42, outputTokensPerTask: 1800,
    },
  },
  {
    sourceProvider: 'google',
    model: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash',
    kind: 'proprietary',
    capabilities: cap(1_000_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 0.5, outputPerM: 3 },
    signals: {
      arenaRank: 6, agentSuccess: 91.9, toolReliability: 95.4, steerability: 92.7,
      coding: 92.8, reasoning: 92.4, bashRecovery: 90.6, toolHallucination: 4.4,
      speedSeconds: 1.1, costPerTask: 0.14, outputTokensPerTask: 1600,
    },
  },
  {
    sourceProvider: 'openai',
    model: 'gpt-5.6-mini',
    displayName: 'GPT-5.6 Mini',
    kind: 'proprietary',
    capabilities: cap(200_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 0.4, outputPerM: 2 },
    signals: {
      arenaRank: 7, agentSuccess: 90.2, toolReliability: 94.8, steerability: 91.5,
      coding: 91.2, reasoning: 90.8, bashRecovery: 88.9, toolHallucination: 5.1,
      speedSeconds: 0.9, costPerTask: 0.09, outputTokensPerTask: 1300,
    },
  },
  {
    sourceProvider: 'mistral',
    model: 'mistral-large-3',
    displayName: 'Mistral Large 3',
    kind: 'proprietary',
    capabilities: cap(128_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 2, outputPerM: 6 },
    signals: {
      arenaRank: 8, agentSuccess: 89.6, toolReliability: 93.2, steerability: 90.4,
      coding: 90.1, reasoning: 89.7, bashRecovery: 87.8, toolHallucination: 6.2,
      speedSeconds: 1.6, costPerTask: 0.28, outputTokensPerTask: 1500,
    },
  },
  {
    sourceProvider: 'openrouter',
    model: 'qwen/qwen3-max',
    displayName: 'Qwen3 Max',
    kind: 'hybrid',
    capabilities: cap(256_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 1.2, outputPerM: 6 },
    signals: {
      arenaRank: 9, agentSuccess: 89.1, toolReliability: 92.7, steerability: 91.1,
      coding: 91.4, reasoning: 90.2, bashRecovery: 87.1, toolHallucination: 6.6,
      speedSeconds: 1.9, costPerTask: 0.24, outputTokensPerTask: 1700,
    },
  },
  {
    sourceProvider: 'openrouter',
    model: 'deepseek/deepseek-v4',
    displayName: 'DeepSeek V4',
    kind: 'open-source',
    capabilities: cap(128_000, { vision: false, tools: true, structured: true }),
    pricing: { inputPerM: 0.4, outputPerM: 1.6 },
    signals: {
      arenaRank: 10, agentSuccess: 88.7, toolReliability: 92.1, steerability: 89.8,
      coding: 90.8, reasoning: 89.9, bashRecovery: 86.4, toolHallucination: 7.1,
      speedSeconds: 2.1, costPerTask: 0.08, outputTokensPerTask: 1800,
    },
  },
  {
    sourceProvider: 'openrouter',
    model: 'meta-llama/llama-4-maverick',
    displayName: 'Llama 4 Maverick',
    kind: 'open-source',
    capabilities: cap(128_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 0.2, outputPerM: 0.8 },
    signals: {
      arenaRank: 11, agentSuccess: 86.4, toolReliability: 89.5, steerability: 87.2,
      coding: 87.9, reasoning: 86.8, bashRecovery: 83.9, toolHallucination: 8.8,
      speedSeconds: 1.4, costPerTask: 0.05, outputTokensPerTask: 1400,
    },
  },
  {
    sourceProvider: 'anthropic',
    model: 'claude-haiku-4.5',
    displayName: 'Claude Haiku 4.5',
    kind: 'proprietary',
    capabilities: cap(200_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 1, outputPerM: 5 },
    signals: {
      arenaRank: 12, agentSuccess: 85.8, toolReliability: 90.2, steerability: 88.1,
      coding: 86.2, reasoning: 85.4, bashRecovery: 82.6, toolHallucination: 9.2,
      speedSeconds: 0.8, costPerTask: 0.05, outputTokensPerTask: 1100,
    },
  },
  {
    sourceProvider: 'xai',
    model: 'grok-4.1-fast',
    displayName: 'Grok 4.1 Fast',
    kind: 'proprietary',
    capabilities: cap(256_000, { vision: true, tools: true, structured: true }),
    pricing: { inputPerM: 0.5, outputPerM: 2.5 },
    signals: {
      arenaRank: 13, agentSuccess: 85.2, toolReliability: 89.0, steerability: 88.4,
      coding: 86.7, reasoning: 85.5, bashRecovery: 81.7, toolHallucination: 9.8,
      speedSeconds: 0.7, costPerTask: 0.06, outputTokensPerTask: 1000,
    },
  },
  {
    sourceProvider: 'google',
    model: 'gemini-3-flash-lite',
    displayName: 'Gemini 3 Flash Lite',
    kind: 'proprietary',
    capabilities: cap(1_000_000, { vision: true, tools: true, structured: false }),
    pricing: { inputPerM: 0.1, outputPerM: 0.4 },
    signals: {
      arenaRank: 14, agentSuccess: 84.9, toolReliability: 88.4, steerability: 86.6,
      coding: 85.1, reasoning: 84.3, bashRecovery: 80.9, toolHallucination: 10.4,
      speedSeconds: 0.6, costPerTask: 0.02, outputTokensPerTask: 900,
    },
  },
  {
    sourceProvider: 'openrouter',
    model: 'qwen/qwen3-coder-480b',
    displayName: 'Qwen3 Coder 480B',
    kind: 'open-source',
    capabilities: cap(256_000, { vision: false, tools: true, structured: true }),
    pricing: { inputPerM: 0.6, outputPerM: 2.4 },
    signals: {
      arenaRank: 15, agentSuccess: 84.3, toolReliability: 88.7, steerability: 86.9,
      coding: 92.5, reasoning: 84.1, bashRecovery: 84.2, toolHallucination: 8.1,
      speedSeconds: 2.4, costPerTask: 0.11, outputTokensPerTask: 2000,
    },
  },
  {
    sourceProvider: 'mistral',
    model: 'mistral-small-3.2',
    displayName: 'Mistral Small 3.2',
    kind: 'open-source',
    capabilities: cap(128_000, { vision: false, tools: true, structured: true }),
    pricing: { inputPerM: 0.1, outputPerM: 0.3 },
    signals: {
      arenaRank: 16, agentSuccess: 83.7, toolReliability: 87.1, steerability: 85.2,
      coding: 84.6, reasoning: 83.9, bashRecovery: 79.4, toolHallucination: 11.2,
      speedSeconds: 0.9, costPerTask: 0.03, outputTokensPerTask: 800,
    },
  },
  {
    sourceProvider: 'openrouter',
    model: 'deepseek/deepseek-v4-lite',
    displayName: 'DeepSeek V4 Lite',
    kind: 'open-source',
    capabilities: cap(128_000, { vision: false, tools: true, structured: true }),
    pricing: { inputPerM: 0.05, outputPerM: 0.2 },
    signals: {
      arenaRank: 17, agentSuccess: 81.8, toolReliability: 85.4, steerability: 83.0,
      coding: 83.9, reasoning: 82.6, bashRecovery: 77.8, toolHallucination: 12.6,
      speedSeconds: 1.2, costPerTask: 0.02, outputTokensPerTask: 700,
    },
  },
  {
    sourceProvider: 'openrouter',
    model: 'meta-llama/llama-4-scout',
    displayName: 'Llama 4 Scout',
    kind: 'open-source',
    capabilities: cap(128_000, { vision: true, tools: true, structured: false }),
    pricing: { inputPerM: 0.02, outputPerM: 0.08 },
    signals: {
      arenaRank: 18, agentSuccess: 80.1, toolReliability: 83.6, steerability: 81.2,
      coding: 82.4, reasoning: 81.0, bashRecovery: 75.3, toolHallucination: 13.9,
      speedSeconds: 0.5, costPerTask: 0.01, outputTokensPerTask: 600,
    },
  },
];

const byKey = new Map(ARENA_LEADERBOARD.map((e) => [`${e.sourceProvider}:${e.model}`, e]));

export function getArenaEntry(provider: string, model: string): ArenaModelEntry | undefined {
  return byKey.get(`${provider}:${model}`);
}

export function rankedArenaModels(): ArenaModelEntry[] {
  return [...ARENA_LEADERBOARD].sort((a, b) => a.signals.arenaRank - b.signals.arenaRank);
}

/**
 * Pull a fresh leaderboard snapshot from a live Arena endpoint.
 * Returns the bundled snapshot when no endpoint is reachable — the
 * harness must never hard-depend on Arena availability.
 */
export async function fetchArenaLeaderboard(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ArenaModelEntry[]> {
  if (!process.env.TDX_ARENA_API) return ARENA_LEADERBOARD;
  try {
    const res = await fetchImpl(`${process.env.TDX_ARENA_API}/v1/leaderboard?scope=agent`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`arena ${res.status}`);
    const body = (await res.json()) as { models?: ArenaModelEntry[] };
    if (Array.isArray(body.models) && body.models.length > 0) return body.models;
    return ARENA_LEADERBOARD;
  } catch {
    return ARENA_LEADERBOARD;
  }
}
