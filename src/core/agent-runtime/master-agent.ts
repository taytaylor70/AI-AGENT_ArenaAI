/**
 * Master Agent — orchestration.
 *
 *   MASTER AGENT
 *        │
 *   ┌────┴─────────────┐
 *   ▼      ▼           ▼
 *Researcher Coder    Strategist
 *   └────┬─────────────┘
 *        ▼
 *    Reviewer   (up to one revision loop)
 *        ▼
 *    QA / Tester
 *        ▼
 *      Output  +  TDX Scorecard  +  memory learning
 */

import type { AgentResult, RoutingStrategy, Task } from '../../types.js';
import type { ModelCatalog } from '../../catalog.js';
import type { ModelRouter } from '../model-router/router.js';
import type { ModelIntelligence } from '../model-router/intelligence.js';
import type { ToolRegistry } from '../../tools/tool.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { AuditTrail } from '../policies/audit.js';
import type { PermissionManager } from '../policies/permissions.js';
import type { ApprovalGate } from '../policies/approvals.js';
import { createTask } from '../task-engine/task.js';
import { analyzeTask, type TaskAnalysis } from '../task-engine/task-analyzer.js';
import { plan, type ExecutionPlan, type PlanStep } from '../planning/planner.js';
import { ROLES, type RoleId } from '../planning/roles.js';
import { Agent } from './agent.js';
import { computeTdxScore, type ScorecardInput } from '../../evaluation/scorecard.js';
import { renderTdxScore } from '../../evaluation/scorecard.js';

export interface RunReport {
  task: Task;
  analysis: TaskAnalysis;
  plan: ExecutionPlan;
  results: Map<string, AgentResult>;
  finalOutput: string;
  totalCostUsd: number;
  totalLatencyMs: number;
  startedAt: number;
  durationMs: number;
  scorecard: { block: string; total: number; input: ScorecardInput };
}

export interface MasterAgentOptions {
  catalog: ModelCatalog;
  intelligence: ModelIntelligence;
  router: ModelRouter;
  tools: ToolRegistry;
  memory: MemoryEngine;
  audit: AuditTrail;
  permissions: PermissionManager;
  approvals: ApprovalGate;
  workspaceRoot: string;
  projectId?: string;
  strategy?: RoutingStrategy;
}

let runCounter = 0;

export class MasterAgent {
  constructor(private opts: MasterAgentOptions) {}

  async run(taskText: string, constraints: string[] = []): Promise<RunReport> {
    const startedAt = Date.now();
    const { catalog, intelligence, router, tools, memory, audit, permissions, approvals, workspaceRoot } = this.opts;
    const projectId = this.opts.projectId ?? 'default';

    const task = createTask(taskText, constraints);
    const analysis = analyzeTask(taskText);
    const planDoc = plan(task, analysis);
    memory.beginTask(projectId);
    const runId = `run_${(runCounter++).toString(36)}_${task.id.slice(-4)}`;

    const agentFor = (step: PlanStep): Agent =>
      new Agent({
        id: `${runId}:${step.id}`,
        role: ROLES[step.role],
        catalog, intelligence, router, tools, memory, audit, permissions, approvals,
        workspaceRoot,
        projectId,
        strategy: this.opts.strategy,
      });

    const results = new Map<string, AgentResult>();

    const priorContext = (step: PlanStep): string =>
      step.dependsOn
        .map((d) => results.get(d))
        .filter((r): r is AgentResult => Boolean(r))
        .map((r) => `=== ${r.role} (via ${r.catalogId}) ===\n${r.content.slice(0, 900)}`)
        .join('\n\n');

    const runStep = async (step: PlanStep, extraObjective?: string): Promise<AgentResult> => {
      const ctx = priorContext(step);
      const objective = [
        extraObjective ?? step.objective,
        ctx ? `\nContext from earlier steps:\n${ctx}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return agentFor(step).execute(objective, task);
    };

    /* Execute the plan wave by wave (parallel within a wave). */
    for (const wave of planDoc.waves) {
      const settled = await Promise.all(wave.map((step) => runStep(step)));
      wave.forEach((step, i) => results.set(step.id, settled[i]));
    }

    /* Reviewer loop: at most one revision cycle. */
    const reviewStep = planDoc.steps.find((s) => s.role === 'reviewer');
    const implementStep = planDoc.steps.find((s) => s.role === 'coder');
    if (reviewStep && implementStep) {
      let review = results.get('review');
      if (review && review.content.startsWith('CHANGES')) {
        const fix = await runStep(implementStep, [
          implementStep.objective,
          `Revision 1 — the reviewer requested:\n${review.content}`,
          `CODE: re-apply the implementation incorporating the requested changes.`,
        ].join('\n'));
        results.set('implement-revision-1', fix);
        const reReview = await runStep(reviewStep, [
          reviewStep.objective,
          '(revision 1 — re-review after the coder addressed the changes)',
          `\nContext from earlier steps:\n=== coder (via ${fix.catalogId}) ===\n${fix.content.slice(0, 900)}`,
        ].join('\n'));
        results.set('review', reReview);
        review = reReview;
      }
    }

    const qa = results.get('test');
    const impl = results.get('implement-revision-1') ?? results.get('implement');
    const review = results.get('review');

    const finalOutput = [
      `# Output — ${task.text.slice(0, 100)}`,
      impl ? `\n## Implementation (via ${impl.catalogId})\n${impl.content}` : '',
      review ? `\n## Review (via ${review.catalogId})\n${review.content}` : '',
      qa ? `\n## QA (via ${qa.catalogId})\n${qa.content}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    /* Score the run (evaluation -> score -> router feedback). */
    const input = scoreInputFrom(results, qa, review, impl);
    const scorecard = computeTdxScore(input);

    const totalCostUsd = [...results.values()].reduce((n, r) => n + r.costUsd, 0);
    const totalLatencyMs = [...results.values()].reduce((n, r) => n + r.latencyMs, 0);

    /* Durable learning for the next task. */
    const winner = [...results.values()].reduce<AgentResult | null>((best, r) =>
      !best || r.success && (!best.success || r.costUsd < best.costUsd) ? r : best, null);
    if (winner && winner.success) {
      memory.remember(
        `Task "${task.text.slice(0, 80)}" succeeded with ${winner.catalogId} (role ${winner.role}, $${winner.costUsd.toFixed(4)}, ${Math.round(winner.latencyMs)}ms).`,
        ['routing', winner.role, task.requirements.coding ? 'coding' : 'general'],
      );
    }

    const report: RunReport = {
      task,
      analysis,
      plan: planDoc,
      results,
      finalOutput,
      totalCostUsd,
      totalLatencyMs,
      startedAt,
      durationMs: Date.now() - startedAt,
      scorecard: { block: renderTdxScore(scorecard), total: scorecard.total, input },
    };

    audit.record({
      agent: runId,
      model: 'master',
      tool: 'run.complete',
      arguments: { task: task.text.slice(0, 120), roles: analysis.roles, tdxScore: report.scorecard.total },
      result: 'success',
      durationMs: report.durationMs,
      cost: totalCostUsd,
      approval: 'not-required',
      status: `${results.size} step(s) executed, TDX ${report.scorecard.total}`,
    });

    void intelligence;
    return report;
  }
}

function scoreInputFrom(
  results: Map<string, AgentResult>,
  qa: AgentResult | undefined,
  review: AgentResult | undefined,
  impl: AgentResult | undefined,
): ScorecardInput {
  const all = [...results.values()];
  const ok = all.filter((r) => r.success);
  const taskSuccess = all.length ? (ok.length / all.length) * 100 : 0;

  let toolCalls = 0;
  let toolFailures = 0;
  for (const r of all) {
    toolCalls += r.toolCalls;
    toolFailures += r.toolFailures;
  }
  const toolReliability = toolCalls > 0 ? ((toolCalls - toolFailures) / toolCalls) * 100 : 100;

  const recovery = toolFailures === 0 ? 97 : all.some((r) => r.success) ? 90 : 60;
  const steerability = review && review.content.startsWith('APPROVED') ? 96 : review && review.content.startsWith('CHANGES') ? 84 : 90;
  const codeQuality = impl ? (review && review.content.startsWith('APPROVED') ? 95 : review ? 86 : 80) : 82;
  const reasoning = ok.length ? 90 + Math.min(8, all.length * 1.5) : 60;

  const avgLatency = all.length ? all.reduce((n, r) => n + r.latencyMs, 0) / all.length : 0;
  const efficiency = Math.max(40, Math.min(100, 100 - avgLatency / 250));
  const totalCost = all.reduce((n, r) => n + r.costUsd, 0);
  const cost = Math.max(40, Math.min(100, 100 - totalCost * 120));

  return {
    taskSuccess: round1(taskSuccess),
    reasoning: round1(Math.min(reasoning, 98)),
    toolReliability: round1(toolReliability),
    codeQuality: round1(codeQuality),
    recovery: round1(recovery),
    steerability: round1(steerability),
    efficiency: round1(efficiency),
    cost: round1(cost),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
