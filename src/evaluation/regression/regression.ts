/**
 * Regression guard.
 *
 * Keeps a baseline of TDX scores per task. After each run the guard
 * compares current scores against the baseline and flags any metric that
 * moved by more than the threshold — the harness's own CI for the
 * agent pipeline.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TdxScorecard } from '../scorecard.js';

export interface BaselineMetric {
  total: number;
  byMetric: Record<string, number>;
  at: string;
}

export type Baseline = Record<string, BaselineMetric>;

export interface RegressionReport {
  taskId: string;
  verdict: 'pass' | 'regression' | 'new-baseline';
  regressed: Array<{ metric: string; before: number; after: number; delta: number }>;
  improved: Array<{ metric: string; before: number; after: number; delta: number }>;
  totalBefore?: number;
  totalAfter: number;
}

export class RegressionGuard {
  private baseline: Baseline = {};

  constructor(private path?: string, private threshold = 2) {
    if (path) this.load();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      this.baseline = JSON.parse(readFileSync(this.path, 'utf8')) as Baseline;
    } catch {
      this.baseline = {};
    }
  }

  private persist(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.baseline, null, 2));
    renameSync(tmp, this.path);
  }

  getBaseline(taskId: string): BaselineMetric | undefined {
    return this.baseline[taskId];
  }

  evaluate(taskId: string, card: TdxScorecard): RegressionReport {
    const byMetric: Record<string, number> = {};
    for (const [k, v] of Object.entries(card.input)) byMetric[k] = v;
    const before = this.baseline[taskId];
    const totalAfter = card.total;

    if (!before) {
      const report: RegressionReport = {
        taskId,
        verdict: 'new-baseline',
        regressed: [],
        improved: [],
        totalAfter,
      };
      return report;
    }

    const regressed: RegressionReport['regressed'] = [];
    const improved: RegressionReport['improved'] = [];
    const check = (name: string, b: number, a: number): void => {
      const delta = Math.round((a - b) * 10) / 10;
      if (delta <= -this.threshold) regressed.push({ metric: name, before: b, after: a, delta });
      if (delta >= this.threshold) improved.push({ metric: name, before: b, after: a, delta });
    };
    for (const [k, v] of Object.entries(before.byMetric)) {
      check(k, v, byMetric[k] ?? v);
    }
    check('total', before.total, totalAfter);

    const report: RegressionReport = {
      taskId,
      verdict: regressed.length > 0 ? 'regression' : 'pass',
      regressed,
      improved,
      totalBefore: before.total,
      totalAfter,
    };
    return report;
  }

  /** Store the current score as (or into) the baseline. */
  save(taskId: string, card: TdxScorecard): void {
    const byMetric: Record<string, number> = {};
    for (const [k, v] of Object.entries(card.input)) byMetric[k] = v;
    this.baseline[taskId] = { total: card.total, byMetric, at: new Date().toISOString() };
    this.persist();
  }

  renderReport(r: RegressionReport): string {
    const lines = [
      `Regression ${r.taskId}: ${r.verdict.toUpperCase()}`,
      `  total: ${r.totalBefore !== undefined ? `${r.totalBefore} → ` : ''}${r.totalAfter}`,
    ];
    if (r.regressed.length) {
      lines.push(`  REGRESSED: ${r.regressed.map((x) => `${x.metric} ${x.before}→${x.after} (${x.delta})`).join(', ')}`);
    }
    if (r.improved.length) {
      lines.push(`  improved:  ${r.improved.map((x) => `${x.metric} ${x.before}→${x.after} (+${x.delta})`).join(', ')}`);
    }
    return lines.join('\n');
  }
}
