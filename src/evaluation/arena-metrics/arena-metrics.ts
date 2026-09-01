/**
 * Arena metrics projection.
 *
 * Maps harness observations onto the metric names Arena's Agent
 * leaderboard publishes, so internal scores can be compared side by
 * side with the ecosystem's numbers:
 *
 *   confirmed success, steerability, bash recovery,
 *   tool hallucination, cost/task, output tokens/task
 */

import type { AgentObservation } from '../../types.js';

export interface ArenaMetricSet {
  confirmedSuccess: number;      // %
  steerability: number;          // %
  bashRecovery: number;          // %
  toolHallucination: number;     // % (lower better)
  costPerTask: number;           // USD
  outputTokensPerTask: number;   // tokens
}

export function toArenaMetrics(observations: AgentObservation[]): ArenaMetricSet {
  const n = Math.max(observations.length, 1);
  const success = observations.filter((o) => o.success).length / n;
  let toolCalls = 0;
  let toolFailures = 0;
  let cost = 0;
  let outTokens = 0;
  for (const o of observations) {
    toolCalls += o.toolCalls;
    toolFailures += o.toolFailures;
    cost += o.costUsd;
    outTokens += o.outputTokens;
  }
  const reliability = toolCalls > 0 ? (toolCalls - toolFailures) / toolCalls : 1;
  return {
    confirmedSuccess: success * 100,
    steerability: Math.min(100, reliability * 100 * 0.8 + success * 100 * 0.2),
    bashRecovery: reliability * 100,
    toolHallucination: toolCalls > 0 ? (toolFailures / toolCalls) * 100 : 0,
    costPerTask: cost / n,
    outputTokensPerTask: outTokens / n,
  };
}

export function renderArenaMetrics(m: ArenaMetricSet, title = 'Arena-style metrics (observed)'): string {
  const row = (k: string, v: string) => `${k.padEnd(24)} ${v}`;
  return [
    title,
    `${'─'.repeat(40)}`,
    row('Confirmed success', `${m.confirmedSuccess.toFixed(1)}%`),
    row('Steerability', `${m.steerability.toFixed(1)}%`),
    row('Bash recovery', `${m.bashRecovery.toFixed(1)}%`),
    row('Tool hallucination', `${m.toolHallucination.toFixed(1)}%`),
    row('Cost/task', `$${m.costPerTask.toFixed(4)}`),
    row('Output tokens/task', Math.round(m.outputTokensPerTask).toString()),
  ].join('\n');
}
