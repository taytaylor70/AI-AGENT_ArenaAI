/**
 * Intelligent Model Router — the flagship.
 *
 * A request like "Build me a production-ready SaaS application" is never
 * blindly sent to one model. The TaskAnalyzer classifies it, then the
 * router scores every eligible model against the active strategy:
 *
 *   best             maximize quality
 *   fast             minimize latency
 *   cheap            minimize cost
 *   balanced         quality + speed + cost (geometric mean)
 *   arena-champion   strongest Arena leaderboard candidate
 *   auto             harness decides from the task's requirements
 */

import type {
  HarnessModel,
  ModelSelection,
  RoutingStrategy,
  ScoredCandidate,
  Task,
} from '../../types.js';
import type { ModelCatalog } from '../../catalog.js';
import { ModelIntelligence } from './intelligence.js';
import { meetsCapabilities, type CapabilityRequirement } from '../../providers/arena/capabilities.js';

export interface RoleHint {
  id: string;
  title?: string;
  /** Role needs tool calling (agent loop). */
  needsTools: boolean;
  needsVision?: boolean;
  /** Extra context the role will consume (tokens). */
  contextHintTokens?: number;
}

export interface RouterOptions {
  defaultStrategy?: RoutingStrategy;
  /** Only route to models that can execute right now. */
  requireAvailable?: boolean;
  /** Cap on candidates returned. */
  candidateLimit?: number;
}

export class ModelRouter {
  private defaultStrategy: RoutingStrategy;
  private requireAvailable: boolean;
  private candidateLimit: number;

  constructor(
    private catalog: ModelCatalog,
    private intelligence: ModelIntelligence,
    opts: RouterOptions = {},
  ) {
    this.defaultStrategy = opts.defaultStrategy ?? 'balanced';
    this.requireAvailable = opts.requireAvailable ?? true;
    this.candidateLimit = opts.candidateLimit ?? 5;
  }

  /** Resolve 'auto' into a concrete strategy based on the task. */
  resolveStrategy(task: Task, requested: RoutingStrategy | undefined): RoutingStrategy {
    if (requested && requested !== 'auto') return requested;
    const r = task.requirements;
    if (r.coding && r.architecture) return 'best';
    if (r.research && !r.coding) return 'fast';
    if ((r.writing || r.data) && task.estimatedTokens < 1500) return 'fast';
    if (task.estimatedTokens > 4000) return 'balanced';
    return this.defaultStrategy === 'auto' ? 'balanced' : this.defaultStrategy;
  }

  select(task: Task, role: RoleHint, requested?: RoutingStrategy): ModelSelection {
    const effective = this.resolveStrategy(task, requested);
    const req: CapabilityRequirement = {
      tools: role.needsTools,
      vision: role.needsVision ?? task.hasImages,
      minContext: Math.max(task.estimatedTokens, role.contextHintTokens ?? 0) * 2,
    };

    const pool = this.catalog.list().filter((m) => {
      if (this.requireAvailable && !m.available) return false;
      return meetsCapabilities(m, req);
    });
    if (pool.length === 0) {
      throw new Error(
        `ModelRouter: no model eligible for role "${role.id}" (strategy=${effective}, ` +
          `tools=${role.needsTools}, available-only=${this.requireAvailable})`,
      );
    }

    const minSpeed = Math.min(...pool.map((m) => this.intelligence.profile(m.catalogId).signals.speedSeconds));
    const costs = pool.map((m) => Math.max(this.intelligence.profile(m.catalogId).signals.costPerTask, 1e-6));
    const minCost = Math.min(...costs);
    const maxRank = Math.max(...pool.filter((m) => m.signals.arenaRank > 0).map((m) => m.signals.arenaRank), 1);

    const scored: ScoredCandidate[] = pool.map((m) => {
      const s = this.intelligence.profile(m.catalogId).signals;
      const quality = this.qualityScore(m, s, role);
      const speed = (100 * minSpeed) / Math.max(s.speedSeconds, 0.05);
      const cost = (100 * minCost) / Math.max(s.costPerTask, 1e-6);
      const rankScore = s.arenaRank > 0 ? 100 * (1 - (s.arenaRank - 1) / Math.max(maxRank - 1, 1)) : 0;
      const score = this.strategyScore(effective as Exclude<RoutingStrategy, 'auto'>, quality, speed, cost, rankScore);
      return {
        catalogId: m.catalogId,
        score: round1(score),
        quality: round1(quality),
        speed: round1(speed),
        cost: round1(cost),
        arenaRank: s.arenaRank,
        reasons: reasonStrings(m, s, effective),
      };
    });

    scored.sort((a, b) => b.score - a.score || a.catalogId.localeCompare(b.catalogId));
    const winner = scored[0];
    if (!winner) throw new Error('ModelRouter: empty candidate list');
    const top = scored.slice(0, this.candidateLimit);

    return {
      catalogId: winner.catalogId,
      provider: this.catalog.get(winner.catalogId).provider,
      model: this.catalog.get(winner.catalogId).model,
      strategy: requested ?? this.defaultStrategy,
      effectiveStrategy: effective,
      score: winner.score,
      candidates: top,
      rationale: this.rationale(effective, winner, top),
    };
  }

  private qualityScore(m: HarnessModel, s: LeaderboardSignalsLite, role: RoleHint): number {
    if (role.needsTools) {
      return 0.3 * s.agentSuccess + 0.2 * s.coding + 0.15 * s.reasoning + 0.35 * s.toolReliability;
    }
    return 0.4 * s.agentSuccess + 0.25 * s.coding + 0.2 * s.reasoning + 0.15 * s.toolReliability;
  }

  private strategyScore(
    strategy: Exclude<RoutingStrategy, 'auto'>,
    quality: number,
    speed: number,
    cost: number,
    rankScore: number,
  ): number {
    switch (strategy) {
      case 'best':
        return quality;
      case 'fast':
        return speed;
      case 'cheap':
        return cost;
      case 'arena-champion':
        return 0.7 * rankScore + 0.3 * quality;
      case 'balanced': {
        const geo = Math.cbrt(Math.max(quality, 0.01) * Math.max(speed, 0.01) * Math.max(cost, 0.01)) / 100;
        return geo * 100;
      }
    }
  }

  private rationale(effective: string, winner: ScoredCandidate, top: ScoredCandidate[]): string {
    const runnerUp = top[1];
    const parts = [
      `strategy=${effective}`,
      `winner ${winner.catalogId} (score ${winner.score})`,
    ];
    if (winner.arenaRank > 0) parts.push(`arena rank #${winner.arenaRank}`);
    parts.push(`${winner.reasons.join(', ')}`);
    if (runnerUp) parts.push(`beat ${runnerUp.catalogId} (${runnerUp.score})`);
    return parts.join('; ');
  }
}

interface LeaderboardSignalsLite {
  agentSuccess: number;
  toolReliability: number;
  steerability: number;
  coding: number;
  reasoning: number;
  speedSeconds: number;
  costPerTask: number;
  arenaRank: number;
}

function reasonStrings(m: HarnessModel, s: LeaderboardSignalsLite, strategy: string): string[] {
  const r: string[] = [];
  if (s.arenaRank > 0) r.push(`rank #${s.arenaRank}`);
  if (s.agentSuccess >= 93) r.push('high agent success');
  if (s.toolReliability >= 95) r.push('high tool reliability');
  if (s.speedSeconds <= 1) r.push('fast');
  if (s.costPerTask <= 0.05) r.push('very cheap');
  if (s.coding >= 95) r.push('strong coding');
  if (r.length === 0) r.push('solid all-rounder');
  if (strategy === 'arena-champion' && s.arenaRank > 0) r.unshift('arena champion candidate');
  void m;
  return r;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
