import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryEngine } from '../src/core/memory/memory-engine.js';
import { LongTermMemory } from '../src/core/memory/long-term-memory.js';
import { SessionMemory } from '../src/core/memory/session-memory.js';

describe('MemoryEngine (three levels)', () => {
  it('resets working memory between tasks, keeps session + long-term', () => {
    const mem = new MemoryEngine({ projectSessionId: 'proj' });
    mem.beginTask('proj');
    mem.working.set('chosenDb', 'sqlite');
    mem.session('proj').add('user', 'The user store must use SQLite.');
    mem.endTask();
    expect(mem.working.size).toBe(0);
    expect(mem.session('proj').count).toBe(1);
  });

  it('assembles selective context within budget', () => {
    const mem = new MemoryEngine({ projectSessionId: 'p' });
    mem.session('p').add('user', 'We decided the pricing page has three tiers.');
    mem.remember('The user store is SQLite-backed with a users table.', ['saas', 'database']);
    const ctx = mem.assembleContext('p', 'What should the pricing page contain?', { budgetChars: 500 });
    expect(ctx.block).toContain('pricing page');
    expect(ctx.block.toLowerCase()).toContain('sqlite');
    expect(ctx.sources.some((s) => s.level === 'session')).toBe(true);
    expect(ctx.sources.some((s) => s.level === 'long-term')).toBe(true);
    expect(ctx.block.length).toBeLessThanOrEqual(520);
  });

  it('long-term memory retrieves selectively by relevance (no dump)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tdx-mem-'));
    const lt = new LongTermMemory(join(dir, 'lt.json'));
    lt.store('Deploy pipeline uses GitHub Actions with preview environments.', ['devops']);
    lt.store('The customer said they hate cold email.', ['sales']);
    const hits = lt.retrieve('how do we ship changes to the preview environment?', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].fact).toContain('GitHub Actions');
  });

  it('session recall surfaces the most relevant message', () => {
    const s = new SessionMemory();
    s.add('user', 'The API should use cursor pagination.');
    s.add('user', 'Lunch at noon tomorrow.');
    const block = s.contextBlock('Which pagination strategy did we agree on?', 1);
    expect(block).toContain('cursor pagination');
    expect(block).not.toContain('Lunch');
  });
});
