/**
 * Model Intelligence.
 *
 * Every model receives a dynamic profile. Static Arena leaderboard
 * signals (rank, agent success, tool reliability, steerability, coding,
 * reasoning, speed, cost, bash recovery, tool hallucination) are blended
 * with the harness's own observations — measured latency, success, tool
 * failures and cost from real runs — so the profile improves the more the
 * harness is used. This is the feedback loop from the product definition:
 *
 *   TASK -> MODEL -> AGENT -> TOOLS -> RESULT -> EVALUATION -> SCORE
 *     ^                                                            |
 *     +-------------------- MODEL ROUTER <-------------------------+
 */

import type { AgentObservation, HarnessModel, LeaderboardSignals } from '../../types.js';
import type { ModelCatalog } from '../../catalog.js';
import { modelCard } from '../../providers/arena/capabilities.js';

const ALPHA = 0.35;
const MIN_OBSERVATIONS_FOR_BLEND = 3;

export interface DynamicStats {
  n: number;
  emaSpeedMs: number;
  emaSuccess: number;        // 0-100
  emaToolReliability: number; // 0-100
  emaCostUsd: number;
  emaOutputTokens: number;
  lastAt: number;
}

export interface ResolvedProfile {
  model: HarnessModel;
  /** Leaderboard signals blended with local observations. */
  signals: LeaderboardSignals;
  observations: number;
  dynamic: DynamicStats | null;
}

export class ModelIntelligence {
  private dynamics = new Map<string, DynamicStats>();
  private raws = new Map<string, AgentObservation[]>();

  constructor(private catalog: ModelCatalog) {}

  /** Raw observations (capped at 200 per model) for metrics projection. */
  observations(catalogId?: string): AgentObservation[] {
    if (catalogId) return [...(this.raws.get(catalogId) ?? [])];
    return [...this.raws.values()].flat();
  }

  recordObservation(obs: AgentObservation): void {
    const list = this.raws.get(obs.catalogId) ?? [];
    list.push(obs);
    if (list.length > 200) list.shift();
    this.raws.set(obs.catalogId, list);
    const cur: DynamicStats =
      this.dynamics.get(obs.catalogId) ?? {
        n: 0, emaSpeedMs: 0, emaSuccess: 0, emaToolReliability: 0, emaCostUsd: 0, emaOutputTokens: 0, lastAt: 0,
      };
    const a = cur.n === 0 ? 1 : ALPHA;
    cur.n += 1;
    cur.emaSpeedMs += a * (obs.latencyMs - cur.emaSpeedMs);
    cur.emaSuccess += a * ((obs.success ? 100 : 0) - cur.emaSuccess);
    const toolRel = obs.toolCalls > 0 ? ((obs.toolCalls - obs.toolFailures) / obs.toolCalls) * 100 : 100;
    cur.emaToolReliability += a * (toolRel - cur.emaToolReliability);
    cur.emaCostUsd += a * (obs.costUsd - cur.emaCostUsd);
    cur.emaOutputTokens += a * (obs.outputTokens - cur.emaOutputTokens);
    cur.lastAt = obs.at;
    this.dynamics.set(obs.catalogId, cur);
  }

  profile(catalogId: string): ResolvedProfile {
    const model = this.catalog.get(catalogId);
    const dyn = this.dynamics.get(catalogId) ?? null;
    const base = model.signals;
    if (!dyn || dyn.n < MIN_OBSERVATIONS_FOR_BLEND) {
      return { model, signals: { ...base }, observations: dyn?.n ?? 0, dynamic: dyn };
    }
    const blend = (staticV: number, dynamicV: number) => 0.55 * staticV + 0.45 * dynamicV;
    const signals: LeaderboardSignals = {
      ...base,
      speedSeconds: (blend(base.speedSeconds * 1000, dyn.emaSpeedMs) / 1000),
      agentSuccess: blend(base.agentSuccess, dyn.emaSuccess),
      toolReliability: blend(base.toolReliability, dyn.emaToolReliability),
      costPerTask: blend(base.costPerTask, dyn.emaCostUsd),
      outputTokensPerTask: blend(base.outputTokensPerTask, dyn.emaOutputTokens),
    };
    return { model, signals, observations: dyn.n, dynamic: dyn };
  }

  /** Render the "Model Intelligence" card for a catalog entry. */
  card(catalogId: string): string {
    const p = this.profile(catalogId);
    const footer =
      p.observations > 0
        ? `\n${'─'.repeat(34)}\nLocal observations: ${p.observations} run(s), last ${new Date(p.dynamic?.lastAt ?? 0).toISOString()}`
        : '';
    return `${modelCard(p.model)}${footer}`;
  }
}
