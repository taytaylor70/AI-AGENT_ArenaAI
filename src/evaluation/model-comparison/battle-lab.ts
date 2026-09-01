/**
 * BATTLE LAB — Arena Evaluation Mode.
 *
 * User submits: "Create a landing page for my AI company."
 *
 *          SAME TASK
 *             │
 *  ┌──────────┼──────────┐
 *  ▼          ▼          ▼
 * Model A   Model B   Model C
 *  │          │          │
 *  ▼          ▼          ▼
 * Output     Output     Output
 *  └──────────┼──────────┘
 *             ▼
 *        EVALUATION
 *             │
 *  ┌──────────┼──────────┐
 *  ▼          ▼          ▼
 * Quality    Speed      Cost
 *             │
 *             ▼
 *        WINNER MODEL
 *
 * Results feed straight back into Model Intelligence — the next
 * routing decision is smarter because of the battle.
 */

import type { AgentResult, RoutingStrategy, Task } from '../../types.js';
import type { ModelCatalog } from '../../catalog.js';
import type { ModelIntelligence } from '../../core/model-router/intelligence.js';
import type { ToolRegistry } from '../../tools/tool.js';
import type { MemoryEngine } from '../../core/memory/memory-engine.js';
import type { AuditTrail } from '../../core/policies/audit.js';
import type { PermissionManager } from '../../core/policies/permissions.js';
import type { ApprovalGate } from '../../core/policies/approvals.js';
import { analyzeTask, type TaskAnalysis } from '../../core/task-engine/task-analyzer.js';
import { createTask } from '../../core/task-engine/task.js';
import { ROLES } from '../../core/planning/roles.js';
import { Agent } from '../../core/agent-runtime/agent.js';
import { HeuristicJudge, type JudgeResult } from './judge.js';

export interface BattleEntry {
  catalogId: string;
  displayName: string;
  judge: JudgeResult;
  quality: number;
  speedMs: number;
  costUsd: number;
  toolCalls: number;
  toolFailures: number;
  outputTokens: number;
  success: boolean;
  score: number;
  notes: string[];
}

export interface BattleReport {
  taskText: string;
  startedAt: number;
  durationMs: number;
  entries: BattleEntry[];
  winner: BattleEntry | null;
  block: string;
}

export interface BattleLabOptions {
  catalog: ModelCatalog;
  intelligence: ModelIntelligence;
  tools: ToolRegistry;
  memory: MemoryEngine;
  audit: AuditTrail;
  permissions: PermissionManager;
  approvals: ApprovalGate;
  workspaceRoot: string;
  judge?: HeuristicJudge;
  strategy?: RoutingStrategy;
}

const WEIGHTS = { quality: 0.6, speed: 0.15, cost: 0.1, reliability: 0.15 };

export class BattleLab {
  constructor(private opts: BattleLabOptions) {}

  async run(taskText: string, modelIds: string[]): Promise<BattleReport> {
    const startedAt = Date.now();
    const { catalog, intelligence, tools, memory, audit, permissions, approvals, workspaceRoot } = this.opts;
    const judge = this.opts.judge ?? new HeuristicJudge();
    const task: Task = createTask(taskText);
    const analysis: TaskAnalysis = analyzeTask(taskText);
    const projectId = `battle_${startedAt.toString(36)}`;
    memory.beginTask(projectId);

    const objective = [
      taskText,
      (analysis.requirements.coding || analysis.requirements.ui ? 'CODE: implement the core artifact.' : '') +
        (analysis.requirements.database ? ' DB: inspect the data layer.' : '') +
        (analysis.requirements.research ? ` SEARCH: ${taskText.slice(0, 100)}` : ''),
    ]
      .filter(Boolean)
      .join('\n');

    const settled = await Promise.all(
      modelIds.map(async (catalogId): Promise<BattleEntry> => {
        const model = catalog.get(catalogId);
        if (!model.available) {
          return {
            catalogId,
            displayName: model.displayName,
            judge: { quality: 0, notes: ['not executable: no provider key configured'] },
            quality: 0, speedMs: 0, costUsd: 0, toolCalls: 0, toolFailures: 0, outputTokens: 0,
            success: false, score: 0,
            notes: ['not executable: no provider key configured'],
          };
        }
        const agent = new Agent({
          id: `battle:${catalogId}`,
          role: ROLES.coder,
          catalog, intelligence,
          router: { select: () => { throw new Error('battle lab pins models; router unused'); } } as never,
          tools, memory, audit, permissions, approvals,
          workspaceRoot,
          projectId,
          forceModelId: catalogId,
          maxToolRounds: 5,
        });
        const t0 = Date.now();
        const result: AgentResult = await agent.execute(objective, task);
        const speedMs = Date.now() - t0;
        const jr = judge.judge(taskText, task.requirements, result.content, result.toolFailures, result.success);
        return {
          catalogId,
          displayName: model.displayName,
          judge: jr,
          quality: jr.quality,
          speedMs,
          costUsd: result.costUsd,
          toolCalls: result.toolCalls,
          toolFailures: result.toolFailures,
          outputTokens: result.usage.outputTokens,
          success: result.success,
          score: 0, // normalized below
          notes: jr.notes,
        };
      }),
    );

    /* Normalize speed/cost/reliability to 0-100 and combine. */
    const runnable = settled.filter((e) => e.success);
    const minSpeed = Math.min(...runnable.map((e) => e.speedMs), Infinity);
    const minCost = Math.min(...runnable.map((e) => e.costUsd), Infinity);
    for (const e of settled) {
      const speedScore = e.success && runnable.length ? (100 * (minSpeed === Infinity ? 0 : minSpeed)) / Math.max(e.speedMs, 1) : 0;
      const costScore = e.success && runnable.length ? (100 * (minCost === Infinity ? 0 : minCost)) / Math.max(e.costUsd, 1e-9) : 0;
      const relScore = e.success ? (e.toolCalls === 0 ? 100 : ((e.toolCalls - e.toolFailures) / e.toolCalls) * 100) : 0;
      e.score = Math.round(
        (e.quality * WEIGHTS.quality + Math.max(0, speedScore) * WEIGHTS.speed + Math.max(0, costScore) * WEIGHTS.cost + relScore * WEIGHTS.reliability) * 10,
      ) / 10;
    }

    settled.sort((a, b) => b.score - a.score);
    const winner = settled.length > 0 && settled[0].success ? settled[0] : null;
    if (winner) {
      intelligence.recordObservation({
        catalogId: winner.catalogId,
        latencyMs: winner.speedMs,
        success: true,
        toolCalls: winner.toolCalls,
        toolFailures: winner.toolFailures,
        inputTokens: 0,
        outputTokens: winner.outputTokens,
        costUsd: winner.costUsd,
        at: Date.now(),
      });
    }

    audit.record({
      agent: 'battle-lab',
      model: modelIds.join(','),
      tool: 'battle.run',
      arguments: { task: taskText.slice(0, 120), models: modelIds },
      result: 'success',
      durationMs: Date.now() - startedAt,
      approval: 'not-required',
      status: winner ? `winner ${winner.catalogId} (${winner.score})` : 'no model completed',
    });

    return {
      taskText,
      startedAt,
      durationMs: Date.now() - startedAt,
      entries: settled,
      winner,
      block: renderBattleReport(taskText, settled, winner),
    };
  }
}

export function renderBattleReport(taskText: string, entries: BattleEntry[], winner: BattleEntry | null): string {
  const head = 'MODEL'.padEnd(16) + 'QUALITY'.padEnd(9) + 'SPEED'.padEnd(9) + 'COST'.padEnd(9) + 'TOOLS'.padEnd(8) + 'SCORE';
  const lines = [
    'BATTLE LAB',
    `${'━'.repeat(56)}`,
    `Task: ${taskText.slice(0, 80)}`,
    '',
    head,
    `${'─'.repeat(56)}`,
    ...entries.map((e) =>
      `${(winner?.catalogId === e.catalogId ? '🏆 ' : '   ') + e.catalogId}`.padEnd(16) +
      `${e.quality.toFixed(1)}`.padEnd(9) +
      `${(e.speedMs / 1000).toFixed(2)}s`.padEnd(9) +
      `$${e.costUsd.toFixed(4)}`.padEnd(9) +
      `${e.toolCalls - e.toolFailures}/${e.toolCalls}`.padEnd(8) +
      `${e.score.toFixed(1)}`,
    ),
    '',
    winner
      ? `WINNER: ${winner.displayName} (${winner.catalogId}) — score ${winner.score}`
      : 'WINNER: none (no model completed the task)',
    '',
    ...entries.flatMap((e) => e.notes.map((n) => `  ${e.catalogId}: ${n}`)),
  ];
  return lines.join('\n');
}
