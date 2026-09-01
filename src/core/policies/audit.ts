/**
 * Audit trail.
 *
 * Every agent action is recorded with:
 *   timestamp, agent, model, tool, arguments, result, duration,
 *   tokens, cost, approval, status
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type AuditResult = 'success' | 'denied' | 'approved' | 'rejected' | 'error';
export type AuditApproval = 'not-required' | 'granted' | 'denied';

export interface AuditEntry {
  timestamp: string;
  agent: string;
  model: string;
  tool: string;
  arguments: Record<string, unknown>;
  result: AuditResult;
  durationMs: number;
  tokens?: number;
  cost?: number;
  approval: AuditApproval;
  status: string;
  detail?: string;
}

export interface AuditQuery {
  agent?: string;
  tool?: string;
  result?: AuditResult;
  limit?: number;
}

export class AuditTrail {
  private entries: AuditEntry[] = [];
  constructor(private jsonlPath?: string) {
    if (this.jsonlPath) {
      mkdirSync(dirname(this.jsonlPath), { recursive: true });
      if (!existsSync(this.jsonlPath)) writeFileSync(this.jsonlPath, '');
    }
  }

  record(e: Omit<AuditEntry, 'timestamp'>): AuditEntry {
    const full: AuditEntry = { timestamp: new Date().toISOString(), ...e };
    this.entries.push(full);
    if (this.jsonlPath) {
      try {
        appendFileSync(this.jsonlPath, `${JSON.stringify(full)}\n`);
      } catch {
        /* audit sink is best-effort; never break the agent loop */
      }
    }
    return full;
  }

  query(q: AuditQuery = {}): AuditEntry[] {
    let out = this.entries;
    if (q.agent) out = out.filter((e) => e.agent === q.agent);
    if (q.tool) out = out.filter((e) => e.tool === q.tool);
    if (q.result) out = out.filter((e) => e.result === q.result);
    return out.slice(-(q.limit ?? 50));
  }

  recent(n = 20): AuditEntry[] {
    return this.entries.slice(-n);
  }

  get size(): number {
    return this.entries.length;
  }

  summary(): string {
    const by = (f: (e: AuditEntry) => boolean) => this.entries.filter(f).length;
    return [
      `Audit entries: ${this.entries.length}`,
      `  success: ${by((e) => e.result === 'success')}`,
      `  denied (permission): ${by((e) => e.result === 'denied')}`,
      `  rejected (approval): ${by((e) => e.result === 'rejected')}`,
      `  error: ${by((e) => e.result === 'error')}`,
      `  approvals granted: ${by((e) => e.approval === 'granted')}`,
    ].join('\n');
  }

  render(n = 10): string {
    return this.recent(n)
      .map((e) => {
        const cost = e.cost !== undefined ? ` $${e.cost.toFixed(4)}` : '';
        const tok = e.tokens !== undefined ? ` ${e.tokens}tok` : '';
        return `${e.timestamp}  ${e.agent.padEnd(18)} ${e.model.padEnd(14)} ${e.tool.padEnd(12)} ${e.result.padEnd(9)} ${e.approval.padEnd(12)} ${e.durationMs}ms${tok}${cost}  ${e.status}`;
      })
      .join('\n');
  }

  toText(n = 10): string {
    return this.render(n);
  }
}
