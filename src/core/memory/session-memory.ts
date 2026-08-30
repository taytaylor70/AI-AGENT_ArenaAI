/**
 * Memory — Level 2: Session Memory.
 * Current conversation / project. Rolling summary + recent messages.
 * Recall is lexical (token overlap), so context stays focused instead of
 * dumping the whole transcript into every prompt.
 */

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  at: number;
}

export class SessionMemory {
  private messages: SessionMessage[] = [];
  private summary = '';

  add(role: SessionMessage['role'], content: string): void {
    this.messages.push({ role, content, at: Date.now() });
    if (this.messages.length > this.maxMessages) {
      this.rollingSummarize();
    }
  }

  constructor(private maxMessages = 40) {}

  private rollingSummarize(): void {
    const dropped = this.messages.splice(0, Math.floor(this.messages.length / 2));
    const topics = dropped
      .map((m) => firstLine(m.content))
      .filter(Boolean)
      .slice(0, 6);
    this.summary = [this.summary, `Earlier: ${topics.join(' | ')}`].filter(Boolean).join(' → ').slice(-800);
  }

  recall(query: string, k = 3): SessionMessage[] {
    const q = tokens(query);
    if (q.length === 0) return this.messages.slice(-k);
    const scored = this.messages.map((m) => ({
      m,
      score: q.reduce((n, t) => n + (tokens(m.content).includes(t) ? 1 : 0), 0),
    }));
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.m.at - a.m.at)
      .slice(0, k)
      .map((s) => s.m);
  }

  contextBlock(query: string, k = 3): string {
    const lines: string[] = [];
    if (this.summary) lines.push(`Session so far: ${this.summary}`);
    for (const m of this.recall(query, k)) {
      lines.push(`${m.role}: ${firstLine(m.content, 200)}`);
    }
    return lines.join('\n');
  }

  get count(): number {
    return this.messages.length;
  }
}

function firstLine(s: string, max = 140): string {
  const l = s.split('\n')[0].trim();
  return l.length > max ? `${l.slice(0, max)}…` : l;
}

export function tokens(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 2))];
}
