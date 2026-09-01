/**
 * Battle Lab — outcome evaluation.
 *
 * Two evaluators:
 *   - HeuristicJudge: deterministic, offline. Checks the artifact for the
 *     expected sections derived from the task requirements plus output
 *     shape. No model call, fully reproducible.
 *   - ModelJudge: asks a judge model (any ModelAdapter) for a 0-100 score.
 *     Works with any model the harness can route to.
 */

import type { ModelAdapter, TaskRequirements } from '../../types.js';

export interface JudgeResult {
  quality: number; // 0-100
  notes: string[];
}

export interface SectionCheck {
  id: string;
  /** The artifact must contain evidence of delivery, not just the topic word. */
  pattern: RegExp;
}

export function expectedSections(requirements: TaskRequirements, taskText: string): SectionCheck[] {
  const out: SectionCheck[] = [];
  const t = taskText.toLowerCase();
  if (requirements.coding) out.push({ id: 'implement', pattern: /implement\w*|built|created|complete/i });
  if (requirements.ui || /\blanding page|page|ui\b/.test(t)) {
    out.push({ id: 'page', pattern: /page (built|assembled|created|shipped)|landing page (built|assembled|created)/i });
  }
  if (requirements.database || /\bsqlite|database|db\b/.test(t)) {
    out.push({ id: 'sql', pattern: /\bsql\w*|database (schema|design)|users table/i });
  }
  if (/\bpricing\b/.test(t)) out.push({ id: 'pricing', pattern: /pricing (table|section|plans|tiers?)/i });
  if (/\bapi\b/.test(t)) out.push({ id: 'api', pattern: /api (contract|endpoint|designed|built|defined)|rest api/i });
  if (requirements.security || /\bauth|login\b/.test(t)) {
    out.push({ id: 'auth', pattern: /auth\w* (flow|built|designed)|login (built|designed)/i });
  }
  if (out.length === 0) out.push({ id: 'answer', pattern: /answer|done|summary|points?\b/i });
  return out;
}

export class HeuristicJudge {
  judge(taskText: string, requirements: TaskRequirements, content: string, toolFailures: number, success: boolean): JudgeResult {
    const notes: string[] = [];
    const sections = expectedSections(requirements, taskText);
    const found = sections.filter((s) => s.pattern.test(content));
    const sectionScore = sections.length ? (found.length / sections.length) * 60 : 40;
    const lengthScore = Math.min(20, (content.length / 40) * 20);
    const structureScore = /(^|\n)([-*]|\d+\.)\s/.test(content) ? 15 : 6;
    let quality = sectionScore + lengthScore + structureScore;
    if (!success) quality *= 0.5;
    quality -= toolFailures * 4;
    const missing = sections.filter((s) => !found.includes(s)).map((s) => s.id);
    if (missing.length) notes.push(`missing expected sections: ${missing.join(', ')}`);
    if (toolFailures > 0) notes.push(`${toolFailures} tool failure(s) absorbed`);
    if (notes.length === 0) notes.push('artifact covers the requested scope');
    return { quality: Math.max(0, Math.min(100, Math.round(quality * 10) / 10)), notes };
  }
}

export class ModelJudge {
  constructor(private adapter: ModelAdapter, private model: string) {}

  async judge(taskText: string, content: string): Promise<JudgeResult> {
    const resp = await this.adapter.generate({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a strict evaluator. Score the artifact 0-100 for how well it fulfills the task. ' +
            'Reply with exactly: SCORE: <number> then one line of notes.',
        },
        { role: 'user', content: `TASK:\n${taskText.slice(0, 1200)}\n\nARTIFACT:\n${content.slice(0, 3000)}` },
      ],
      temperature: 0,
      maxTokens: 120,
    });
    const m = /SCORE:\s*(\d{1,3})/i.exec(resp.content);
    const quality = m ? Math.max(0, Math.min(100, Number(m[1]))) : 50;
    const notes = resp.content.split('\n').slice(1).filter(Boolean).map((l) => l.slice(0, 160));
    return { quality, notes: notes.length ? notes : ['judge produced no notes'] };
  }
}
