/**
 * Arena compatibility layer — capabilities & intelligence formatting.
 *
 * Turns raw Arena leaderboard signals into routing intelligence:
 * capability filtering, signal ranking, model cards and head-to-head
 * comparisons.
 */

import type { HarnessModel, LeaderboardSignals } from '../../types.js';

export interface CapabilityRequirement {
  tools?: boolean;
  vision?: boolean;
  structuredOutput?: boolean;
  /** Minimum context length needed for the task. */
  minContext?: number;
}

export function meetsCapabilities(model: HarnessModel, req: CapabilityRequirement): boolean {
  if (req.tools && !model.capabilities.tools) return false;
  if (req.vision && !model.capabilities.vision) return false;
  if (req.structuredOutput && !model.capabilities.structuredOutput) return false;
  if (req.minContext && model.capabilities.contextLength < req.minContext) return false;
  return true;
}

export type SignalKey =
  | 'agentSuccess'
  | 'toolReliability'
  | 'steerability'
  | 'coding'
  | 'reasoning'
  | 'bashRecovery';

/** Higher-is-better signals, sorted descending. */
export function topModels(models: HarnessModel[], signal: SignalKey, n = 5): HarnessModel[] {
  return [...models].sort((a, b) => b.signals[signal] - a.signals[signal]).slice(0, n);
}

/** Lower-is-better (latency, cost, hallucination), sorted ascending. */
export function bottomModels(
  models: HarnessModel[],
  key: 'speedSeconds' | 'costPerTask' | 'toolHallucination',
  n = 5,
): HarnessModel[] {
  return [...models].sort((a, b) => a.signals[key] - b.signals[key]).slice(0, n);
}

/** The "Model Intelligence" card from the product definition. */
export function modelCard(model: HarnessModel): string {
  const s = model.signals;
  const line = (k: string, v: string) => `${k.padEnd(16)} ${v}`;
  const ctx = formatContext(model.capabilities.contextLength);
  return [
    model.displayName.toUpperCase(),
    `${'━'.repeat(34)}`,
    line('Arena Rank', s.arenaRank > 0 ? `#${s.arenaRank}` : 'unranked'),
    line('Agent Success', `${s.agentSuccess.toFixed(1)}%`),
    line('Tool Reliability', `${s.toolReliability.toFixed(1)}%`),
    line('Steerability', `${s.steerability.toFixed(1)}%`),
    line('Coding', `${s.coding.toFixed(1)}`),
    line('Reasoning', `${s.reasoning.toFixed(1)}`),
    line('Speed', `${s.speedSeconds.toFixed(1)}s`),
    line('Estimated Cost', `$${s.costPerTask.toFixed(2)}/task`),
    line('Context', ctx),
    line('Vision', model.capabilities.vision ? '✓' : '—'),
    line('Tools', model.capabilities.tools ? '✓' : '—'),
    line('Structured Output', model.capabilities.structuredOutput ? '✓' : '—'),
  ].join('\n');
}

export interface ComparisonRow {
  signal: keyof LeaderboardSignals;
  a: number;
  b: number;
  edge: 'a' | 'b' | 'tie';
  betterFor: 'higher' | 'lower';
}

/** Head-to-head between two models across the Arena metric set. */
export function compareModels(a: HarnessModel, b: HarnessModel): ComparisonRow[] {
  const defs: Array<[keyof LeaderboardSignals, 'higher' | 'lower']> = [
    ['arenaRank', 'lower'],
    ['agentSuccess', 'higher'],
    ['toolReliability', 'higher'],
    ['steerability', 'higher'],
    ['coding', 'higher'],
    ['reasoning', 'higher'],
    ['bashRecovery', 'higher'],
    ['toolHallucination', 'lower'],
    ['speedSeconds', 'lower'],
    ['costPerTask', 'lower'],
  ];
  return defs.map(([signal, betterFor]) => {
    const av = a.signals[signal];
    const bv = b.signals[signal];
    const edge =
      betterFor === 'higher' ? (av > bv ? 'a' : bv > av ? 'b' : 'tie') : av < bv ? 'a' : bv < av ? 'b' : 'tie';
    return { signal, a: av, b: bv, edge, betterFor };
  });
}

export function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
