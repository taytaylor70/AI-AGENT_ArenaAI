/**
 * Memory Engine — the façade over all three levels.
 *
 *             MEMORY ENGINE
 *                  │
 *        ┌─────────┼──────────┐
 *        ▼         ▼          ▼
 *    Working     Session    Long-Term
 *    Memory      Memory     Knowledge
 *
 * `assembleContext` is how the harness injects memory into a prompt:
 * working memory first, then a small recall window from the session,
 * then top-k long-term facts. Selective — never a dump.
 */

import { WorkingMemory } from './working-memory.js';
import { SessionMemory } from './session-memory.js';
import { LongTermMemory } from './long-term-memory.js';

export interface ContextAssembly {
  block: string;
  sources: Array<{ level: 'working' | 'session' | 'long-term'; chars: number }>;
}

export class MemoryEngine {
  readonly working = new WorkingMemory();
  readonly longTerm: LongTermMemory;
  private sessions = new Map<string, SessionMemory>();

  constructor(opts: { projectSessionId?: string; longTermPath?: string } = {}) {
    this.longTerm = new LongTermMemory(opts.longTermPath);
    if (opts.projectSessionId) this.session(opts.projectSessionId);
  }

  session(id: string): SessionMemory {
    let s = this.sessions.get(id);
    if (!s) {
      s = new SessionMemory();
      this.sessions.set(id, s);
    }
    return s;
  }

  /** New task: reset working memory, keep session + long-term. */
  beginTask(projectId: string): WorkingMemory {
    this.working.clear();
    this.session(projectId);
    return this.working;
  }

  endTask(): void {
    this.working.clear();
  }

  /**
   * Assemble the memory block for a prompt with an approximate
   * character budget (roughly 4 chars/token).
   */
  assembleContext(projectId: string, query: string, opts: { longTermK?: number; sessionK?: number; budgetChars?: number } = {}): ContextAssembly {
    const budget = opts.budgetChars ?? 2400;
    const sources: ContextAssembly['sources'] = [];
    const parts: string[] = [];
    let used = 0;

    const take = (level: 'working' | 'session' | 'long-term', block: string): void => {
      if (!block) return;
      const remaining = budget - used;
      if (remaining <= 0) return;
      const cut = block.length > remaining ? `${block.slice(0, remaining)}…` : block;
      parts.push(cut);
      sources.push({ level, chars: cut.length });
      used += cut.length;
    };

    const working = this.working.all();
    if (Object.keys(working).length > 0) {
      take('working', `Working memory:\n${Object.entries(working).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n')}`);
    }
    take('session', this.session(projectId).contextBlock(query, opts.sessionK ?? 3));
    take('long-term', this.longTerm.contextBlock(query, opts.longTermK ?? 3));

    return { block: parts.join('\n\n'), sources };
  }

  /** Persist a durable learning (feedback loop). */
  remember(fact: string, tags: string[]): string {
    return this.longTerm.store(fact, tags, 'harness-run');
  }
}
