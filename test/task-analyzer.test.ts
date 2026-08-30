import { describe, expect, it } from 'vitest';
import { analyzeTask } from '../src/core/task-engine/task-analyzer.js';
import { createTask } from '../src/core/task-engine/task.js';

describe('TaskAnalyzer', () => {
  it('classifies the flagship SaaS task', () => {
    const a = analyzeTask(
      'Build me a production-ready SaaS application: a landing page with a pricing table, a Node.js REST API, and a SQLite-backed user store with auth.',
    );
    expect(a.requirements.coding).toBe(true);
    expect(a.requirements.ui).toBe(true);
    expect(a.requirements.database).toBe(true);
    expect(a.requirements.architecture).toBe(true);
    expect(a.requirements.security).toBe(true);
    expect(a.requirements.research).toBe(false);
    expect(a.roles).toContain('coder');
    expect(a.roles).toContain('strategist');
    expect(a.roles).toContain('reviewer');
    expect(a.roles).toContain('qa');
    expect(a.complexity).toBeGreaterThanOrEqual(4);
  });

  it('staffs a researcher when the task asks for research', () => {
    const a = analyzeTask('Research the competitive landscape for AI agent harnesses and compare the top five players.');
    expect(a.requirements.research).toBe(true);
    expect(a.roles).toContain('researcher');
  });

  it('detects risk flags on dangerous language', () => {
    const a = analyzeTask('Deploy the new release and delete all rows from the users table in production.');
    expect(a.riskFlags).toContain('DEPLOY');
    expect(a.riskFlags).toContain('DELETE');
  });

  it('keeps a trivial task minimal', () => {
    const a = analyzeTask('Quick: what is a prime number?');
    expect(a.complexity).toBe(1);
    expect(a.roles.length).toBeLessThanOrEqual(2);
  });

  it('createTask estimates tokens and flags images', () => {
    const t = createTask('Design a UI component from this screenshot.png');
    expect(t.hasImages).toBe(true);
    expect(t.estimatedTokens).toBeGreaterThan(0);
  });
});
