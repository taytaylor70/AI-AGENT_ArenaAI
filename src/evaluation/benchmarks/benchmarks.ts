/**
 * Benchmarks — a fixed suite of standard tasks the harness can run
 * against any model to produce comparable numbers.
 */

import type { ModelCatalog } from '../../catalog.js';
import type { ModelIntelligence } from '../../core/model-router/intelligence.js';
import type { ToolRegistry } from '../../tools/tool.js';
import type { MemoryEngine } from '../../core/memory/memory-engine.js';
import type { AuditTrail } from '../../core/policies/audit.js';
import type { PermissionManager } from '../../core/policies/permissions.js';
import type { ApprovalGate } from '../../core/policies/approvals.js';
import { createTask } from '../../core/task-engine/task.js';
import { analyzeTask } from '../../core/task-engine/task-analyzer.js';
import { ROLES } from '../../core/planning/roles.js';
import { Agent } from '../../core/agent-runtime/agent.js';
import { HeuristicJudge } from '../model-comparison/judge.js';

export interface BenchmarkTask {
  id: string;
  text: string;
  kind: 'code' | 'data' | 'research' | 'writing';
}

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: 'bm-sieve',
    kind: 'code',
    text: 'CODE: implement the Sieve of Eratosthenes in JavaScript that returns all primes under 100, and verify it by running the code.',
  },
  {
    id: 'bm-json',
    kind: 'data',
    text: 'CODE: implement and run a function that dedupes a JSON array of objects by the "id" field.',
  },
  {
    id: 'bm-slug',
    kind: 'code',
    text: 'CODE: implement and run a slugify function with a quick unit check (TEST: verify with shell:exec or code:run).',
  },
  {
    id: 'bm-research',
    kind: 'research',
    text: 'SEARCH: best practices for REST API versioning — summarize the top recommendations in under 100 words.',
  },
];

export interface BenchmarkResult {
  benchmarkId: string;
  catalogId: string;
  success: boolean;
  quality: number;
  latencyMs: number;
  costUsd: number;
}

export interface BenchmarkReport {
  catalogId: string;
  results: BenchmarkResult[];
  avgQuality: number;
  successRate: number;
}

export async function runBenchmark(opts: {
  catalog: ModelCatalog;
  intelligence: ModelIntelligence;
  tools: ToolRegistry;
  memory: MemoryEngine;
  audit: AuditTrail;
  permissions: PermissionManager;
  approvals: ApprovalGate;
  workspaceRoot: string;
  catalogId: string;
  tasks?: BenchmarkTask[];
}): Promise<BenchmarkReport> {
  const judge = new HeuristicJudge();
  const tasks = opts.tasks ?? BENCHMARK_TASKS;
  const results: BenchmarkResult[] = [];

  for (const bt of tasks) {
    const task = createTask(bt.text);
    const analysis = analyzeTask(bt.text);
    const agent = new Agent({
      id: `bench:${bt.id}:${opts.catalogId}`,
      role: bt.kind === 'research' ? ROLES.researcher : ROLES.coder,
      catalog: opts.catalog,
      intelligence: opts.intelligence,
      router: { select: () => { throw new Error('benchmark pins the model'); } } as never,
      tools: opts.tools,
      memory: opts.memory,
      audit: opts.audit,
      permissions: opts.permissions,
      approvals: opts.approvals,
      workspaceRoot: opts.workspaceRoot,
      projectId: `bench_${opts.catalogId}`,
      forceModelId: opts.catalogId,
      maxToolRounds: 4,
    });
    const t0 = Date.now();
    const res = await agent.execute(bt.text, task);
    const jr = judge.judge(bt.text, task.requirements, res.content, res.toolFailures, res.success);
    results.push({
      benchmarkId: bt.id,
      catalogId: opts.catalogId,
      success: res.success,
      quality: jr.quality,
      latencyMs: Date.now() - t0,
      costUsd: res.costUsd,
    });
  }

  return {
    catalogId: opts.catalogId,
    results,
    avgQuality: Math.round((results.reduce((n, r) => n + r.quality, 0) / Math.max(results.length, 1)) * 10) / 10,
    successRate: results.filter((r) => r.success).length / Math.max(results.length, 1),
  };
}

export function renderBenchmark(r: BenchmarkReport): string {
  return [
    `BENCHMARK REPORT — ${r.catalogId}`,
    `${'─'.repeat(48)}`,
    ...r.results.map((x) =>
      `  ${x.benchmarkId.padEnd(14)} ${x.success ? 'OK ' : 'ERR'} quality ${String(x.quality).padStart(5)}  ${x.latencyMs}ms  $${x.costUsd.toFixed(4)}`,
    ),
    `  avg quality ${r.avgQuality} | success rate ${(r.successRate * 100).toFixed(0)}%`,
  ].join('\n');
}
