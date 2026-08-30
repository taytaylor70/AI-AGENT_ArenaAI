/**
 * Memory — Level 3: Long-Term Knowledge.
 * Persistent facts with selective retrieval (top-k by relevance) —
 * never dumped into every prompt.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tokens } from './session-memory.js';

export interface LongTermFact {
  id: string;
  fact: string;
  tags: string[];
  source: string;
  at: number;
  useCount: number;
}

export class LongTermMemory {
  private facts: LongTermFact[] = [];

  constructor(private path?: string) {
    if (path) this.load();
  }

  store(fact: string, tags: string[] = [], source = 'harness'): string {
    const id = `lt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    this.facts.push({ id, fact, tags, source, at: Date.now(), useCount: 0 });
    this.save();
    return id;
  }

  retrieve(query: string, k = 3): LongTermFact[] {
    const q = tokens(query);
    if (q.length === 0) return this.facts.slice(-k);
    const scored = this.facts.map((f) => {
      const body = tokens(`${f.fact} ${f.tags.join(' ')}`);
      let score = q.reduce((n, t) => n + (body.includes(t) ? 1 : 0), 0);
      for (const tag of f.tags) {
        if (query.toLowerCase().includes(tag.toLowerCase())) score += 2;
      }
      return { f, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.f.at - a.f.at)
      .slice(0, k)
      .map(({ f }) => {
        f.useCount += 1;
        return f;
      });
  }

  markUsed(id: string): void {
    const f = this.facts.find((x) => x.id === id);
    if (f) {
      f.useCount += 1;
      this.save();
    }
  }

  all(): LongTermFact[] {
    return [...this.facts];
  }

  prune(unusedForDays = 30): number {
    const cutoff = Date.now() - unusedForDays * 86_400_000;
    const before = this.facts.length;
    this.facts = this.facts.filter((f) => f.useCount > 0 || f.at >= cutoff);
    this.save();
    return before - this.facts.length;
  }

  get size(): number {
    return this.facts.length;
  }

  contextBlock(query: string, k = 3): string {
    const hits = this.retrieve(query, k);
    if (hits.length === 0) return '';
    return `Relevant long-term knowledge:\n${hits.map((f) => `- [${f.tags.join(',')}] ${f.fact}`).join('\n')}`;
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as LongTermFact[];
      this.facts = parsed;
    } catch {
      this.facts = [];
    }
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.facts, null, 2));
    renameSync(tmp, this.path);
  }
}
