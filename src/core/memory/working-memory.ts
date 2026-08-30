/**
 * Memory — Level 1: Working Memory.
 * Current task only. Scratched at task end.
 */

export class WorkingMemory {
  private vars = new Map<string, unknown>();

  set(k: string, v: unknown): void {
    this.vars.set(k, v);
  }

  get<T = unknown>(k: string): T | undefined {
    return this.vars.get(k) as T | undefined;
  }

  has(k: string): boolean {
    return this.vars.has(k);
  }

  all(): Record<string, unknown> {
    return Object.fromEntries(this.vars);
  }

  clear(): void {
    this.vars.clear();
  }

  get size(): number {
    return this.vars.size;
  }
}
