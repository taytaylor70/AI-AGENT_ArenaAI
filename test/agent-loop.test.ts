import { describe, expect, it } from 'vitest';
import { makeTestHarness, tmpWorkspace } from './helpers.js';
import { createTask } from '../src/core/task-engine/task.js';
import { Agent } from '../src/core/agent-runtime/agent.js';
import { ROLES } from '../src/core/planning/roles.js';

function makeAgent(h: Awaited<ReturnType<typeof makeTestHarness>>, role: keyof typeof ROLES, overrides: Record<string, unknown> = {}) {
  return new Agent({
    id: `test:${role}`,
    role: ROLES[role],
    catalog: h.catalog,
    intelligence: h.intelligence,
    router: h.router,
    tools: h.tools,
    memory: h.memory,
    audit: h.audit,
    permissions: h.permissions,
    approvals: h.approvals,
    workspaceRoot: tmpWorkspace(),
    projectId: 'test',
    ...overrides,
  } as ConstructorParameters<typeof Agent>[0]);
}

describe('Agent loop (simulated models, real tools)', () => {
  it('researcher calls web:search then finishes', async () => {
    const h = await makeTestHarness();
    const agent = makeAgent(h, 'researcher', { forceModelId: 'sim:obsidian' });
    const res = await agent.execute('Gather context.\nSEARCH: edge caching best practices', createTask('research edge caching'));
    expect(res.success).toBe(true);
    expect(res.toolCalls).toBe(1);
    expect(res.toolFailures).toBe(0);
    expect(res.content).toContain('Tool web:search output incorporated');
    // the search tool itself returns deterministic simulated results
    const search = await h.tools.execute('web:search', { query: 'x' }, {
      agentId: 'test:researcher',
      modelId: 'sim:obsidian',
      workspaceRoot: h.workspaceRoot,
    });
    expect(search.result.output).toContain('simulated');
    const audit = h.audit.query({ agent: 'test:researcher' });
    expect(audit.some((e) => e.tool === 'web:search' && e.result === 'success')).toBe(true);
    expect(audit.some((e) => e.tool === 'agent.run' && e.cost !== undefined && e.tokens !== undefined)).toBe(true);
  });

  it('coder runs code:run through the sandbox', async () => {
    const h = await makeTestHarness();
    const agent = makeAgent(h, 'coder', { forceModelId: 'sim:atlas' });
    const res = await agent.execute('Implement the artifact.\nCODE: build a pricing table', createTask('build a pricing table'));
    expect(res.success).toBe(true);
    expect(res.toolCalls).toBe(1);
    expect(res.content).toContain('Done');
    const ws = h.workspaceRoot;
    void ws;
  });

  it('records an intelligence observation per run', async () => {
    const h = await makeTestHarness();
    const agent = makeAgent(h, 'researcher', { forceModelId: 'sim:herald' });
    await agent.execute('SEARCH: vector databases', createTask('compare vector databases'));
    expect(h.intelligence.profile('sim:herald').observations).toBe(1);
  });

  it('denies tools the agent lacks permission for (least privilege)', async () => {
    const h = await makeTestHarness();
    // reviewer has no tool permissions at all
    const agent = makeAgent(h, 'reviewer', { forceModelId: 'sim:atlas' });
    const res = await agent.execute('Review.\nSEARCH: something the reviewer should not be able to do', createTask('review'));
    // reviewer role prompt has no SEARCH marker semantics — but even if the model
    // tried web:search, the permission check blocks it. Force a call manually:
    const exec = await h.tools.execute('web:search', { query: 'x' }, {
      agentId: 'test:reviewer',
      modelId: 'sim:atlas',
      workspaceRoot: h.workspaceRoot,
    });
    expect(exec.result.ok).toBe(false);
    expect(exec.result.error).toContain('PERMISSION DENIED');
    expect(exec.audit.result).toBe('denied');
    expect(res.success).toBe(true);
  });

  it('blocks dangerous operations without approval and records the rejection', async () => {
    const h = await makeTestHarness();
    const exec = await h.tools.execute('db:delete', { table: 'users', where: { id: 1 } }, {
      agentId: 'test:coder',
      modelId: 'sim:atlas',
      workspaceRoot: h.workspaceRoot,
    });
    expect(exec.result.ok).toBe(false);
    expect(exec.result.error).toContain('APPROVAL REJECTED');
    expect(exec.approval?.operations).toContain('DELETE');
    expect(exec.audit.approval).toBe('denied');
    // the row must still be there
    const sel = await h.tools.execute('db:select', { table: 'users' }, {
      agentId: 'test:coder',
      modelId: 'sim:atlas',
      workspaceRoot: h.workspaceRoot,
    });
    expect(sel.result.output).toContain('ada@example.com');
  });

  it('executes dangerous operations when the approver grants them', async () => {
    const h = await makeTestHarness({ approver: async () => true });
    const exec = await h.tools.execute('db:delete', { table: 'users', where: { email: 'alan@example.com' } }, {
      agentId: 'test:coder',
      modelId: 'sim:atlas',
      workspaceRoot: h.workspaceRoot,
    });
    expect(exec.result.ok).toBe(true);
    expect(exec.audit.approval).toBe('granted');
    const sel = await h.tools.execute('db:select', { table: 'users', where: { email: 'alan@example.com' } }, {
      agentId: 'test:coder',
      modelId: 'sim:atlas',
      workspaceRoot: h.workspaceRoot,
    });
    expect(sel.result.output).toBe('0 rows in "users"');
  });

  it('survives tool failures (recovery path) when the model absorbs them', async () => {
    const h = await makeTestHarness();
    const agent = makeAgent(h, 'qa', { forceModelId: 'sim:atlas' });
    const res = await agent.execute('Verify the build.\nTEST: run the test suite', createTask('test the build'));
    expect(res.success).toBe(true);
    expect(res.content).toMatch(/PASS|Done/);
  });
});
