/**
 * Planning — turn a task + analysis into an executable pipeline.
 */

import type { Task } from '../../types.js';
import type { TaskAnalysis } from '../task-engine/task-analyzer.js';
import type { RoleId } from './roles.js';

export interface PlanStep {
  id: string;
  role: RoleId;
  objective: string;
  tools: string[];
  dependsOn: string[];
}

export interface ExecutionPlan {
  taskId: string;
  steps: PlanStep[];
  /** Steps that run in parallel waves, in order. */
  waves: PlanStep[][];
}

export function plan(task: Task, analysis: TaskAnalysis): ExecutionPlan {
  const steps: PlanStep[] = [];
  const t = (s: string) => s;

  if (analysis.roles.includes('researcher')) {
    steps.push({
      id: 'research',
      role: 'researcher',
      objective:
        `Research the context needed for:\n"${task.text.slice(0, 400)}"\n` +
        `SEARCH: ${researchQuery(task)}`,
      tools: ['web:search'],
      dependsOn: [],
    });
  }

  if (analysis.roles.includes('strategist')) {
    steps.push({
      id: 'strategy',
      role: 'strategist',
      objective:
        `Produce the execution strategy for:\n"${task.text.slice(0, 400)}"\n` +
        `Detected requirements: ${activeRequirements(analysis)}.`,
      tools: [],
      dependsOn: analysis.roles.includes('researcher') ? ['research'] : [],
    });
  }

  if (analysis.roles.includes('coder')) {
    const needsDb = analysis.requirements.database;
    steps.push({
      id: 'implement',
      role: 'coder',
      objective:
        `Implement the following (show your core work):\n"${task.text.slice(0, 500)}"\n` +
        (analysis.requirements.coding || analysis.requirements.ui
          ? `CODE: implement the core artifact and run a verification snippet.\n`
          : '') +
        (needsDb ? `DB: inspect the "users" table as part of the data design.\n` : ''),
      tools: ['code:run', 'fs:write', 'db:select'],
      dependsOn: steps.map((s) => s.id).filter((id) => id === 'research' || id === 'strategy'),
    });
  }

  if (analysis.roles.includes('reviewer')) {
    steps.push({
      id: 'review',
      role: 'reviewer',
      objective: `Review the artifact produced for the task:\n"${task.text.slice(0, 300)}"`,
      tools: [],
      dependsOn: ['implement'],
    });
  }

  if (analysis.roles.includes('qa')) {
    steps.push({
      id: 'test',
      role: 'qa',
      objective: `Verify the artifact for:\n"${task.text.slice(0, 300)}"\nTEST: run the verification suite.`,
      tools: ['shell:exec', 'code:run'],
      dependsOn: analysis.roles.includes('reviewer') ? ['review'] : ['implement'],
    });
  }

  // Wave scheduler (topological, parallel where independent).
  const byId = new Map(steps.map((s) => [s.id, s]));
  const waves: PlanStep[][] = [];
  const placed = new Set<string>();
  while (placed.size < steps.length) {
    const wave = steps.filter(
      (s) => !placed.has(s.id) && s.dependsOn.every((d) => placed.has(d) || !byId.has(d)),
    );
    if (wave.length === 0) break; // cycle guard
    waves.push(wave);
    for (const s of wave) placed.add(s.id);
  }

  void t;
  return { taskId: task.id, steps, waves };
}

function researchQuery(task: Task): string {
  const m = task.text.match(/"([^"]{10,120})"/);
  return m?.[1] ?? task.text.slice(0, 120).replace(/\s+/g, ' ');
}

function activeRequirements(analysis: TaskAnalysis): string {
  return (Object.entries(analysis.requirements) as Array<[string, boolean]>)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ') || 'general';
}

export function renderPlan(plan: ExecutionPlan): string {
  const lines: string[] = ['EXECUTION PLAN'];
  for (const wave of plan.waves) {
    for (const s of wave) {
      const deps = s.dependsOn.length ? ` ← ${s.dependsOn.join(',')}` : '';
      lines.push(`  [${s.id}] ${s.role.padEnd(11)} ${s.tools.length ? `(${s.tools.join(', ')})` : ''}${deps}`);
    }
  }
  return lines.join('\n');
}
