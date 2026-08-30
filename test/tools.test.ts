import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/tools/tool.js';
import { ApprovalGate } from '../src/core/policies/approvals.js';
import { PermissionManager, TRUSTED_PERMISSIONS } from '../src/core/policies/permissions.js';
import { AuditTrail } from '../src/core/policies/audit.js';
import { createFilesystemTools } from '../src/tools/filesystem/filesystem.js';
import { createCodeTool } from '../src/tools/code/code.js';
import { createDatabaseTools, InMemoryDatabase } from '../src/tools/database/database.js';
import { createHttpTool } from '../src/tools/http/http.js';

type ApproverFn = (req: import('../src/core/policies/approvals.js').ApprovalRequest) => Promise<boolean>;

function makeRegistry(ws: string, approver: ApproverFn = async () => false) {
  const pm = new PermissionManager(TRUSTED_PERMISSIONS);
  const ag = new ApprovalGate(approver);
  const at = new AuditTrail();
  const reg = new ToolRegistry(pm, ag, at);
  for (const t of createFilesystemTools()) reg.register(t);
  reg.register(createCodeTool());
  const db = new InMemoryDatabase();
  for (const t of createDatabaseTools(db)) reg.register(t);
  return { reg, at, ws };
}

describe('Filesystem tools', () => {
  it('writes and reads inside the workspace', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'tdx-fs-'));
    const { reg } = makeRegistry(ws);
    const w = await reg.execute('fs:write', { path: 'out/notes.txt', content: 'hello dynasty' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(w.result.ok).toBe(true);
    const r = await reg.execute('fs:read', { path: 'out/notes.txt' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(r.result.output).toBe('hello dynasty');
    const l = await reg.execute('fs:list', { path: '.' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(l.result.output).toContain('out');
  });

  it('refuses to escape the workspace root', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'tdx-fs-'));
    const secretFile = join(ws, '..', 'tdx-secret.txt');
    writeFileSync(secretFile, 'top secret');
    const { reg } = makeRegistry(ws);
    const r = await reg.execute('fs:read', { path: '../tdx-secret.txt' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(r.result.ok).toBe(false);
    expect(r.audit.result).toBe('error');
    writeFileSync(join(ws, 'tmp.txt'), 'x');
    const d = await reg.execute('fs:delete', { path: 'tmp.txt' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    // fs:delete is dangerous → denied by default approver
    expect(d.result.ok).toBe(false);
    expect(d.result.error).toContain('APPROVAL REJECTED');
  });
});

describe('Code tool', () => {
  it('runs JS in the sandbox and captures output', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'tdx-code-'));
    const { reg } = makeRegistry(ws);
    const r = await reg.execute('code:run', { code: 'console.log(6*7)' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(r.result.ok).toBe(true);
    expect(r.result.output).toContain('42');
  });

  it('times out runaway code instead of hanging', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'tdx-code-'));
    const { reg } = makeRegistry(ws);
    const r = await reg.execute('code:run', { code: 'while(true){}', timeoutMs: 200 }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(r.result.ok).toBe(false);
  }, 10000);
});

describe('Database tools', () => {
  it('insert + select work; delete requires approval', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'tdx-db-'));
    const { reg } = makeRegistry(ws);
    await reg.execute('db:create', { table: 'orders' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    await reg.execute('db:insert', { table: 'orders', row: { id: 1, total: 99 } }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    const sel = await reg.execute('db:select', { table: 'orders' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(sel.result.output).toContain('99');
    const del = await reg.execute('db:delete', { table: 'orders', where: { id: 1 } }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(del.result.ok).toBe(false);
    expect(del.approval?.operations).toContain('DELETE');
  });
});

describe('HTTP tool', () => {
  it('respects the domain allowlist', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'tdx-http-'));
    const pm = new PermissionManager(TRUSTED_PERMISSIONS);
    const reg = new ToolRegistry(pm, new ApprovalGate(), new AuditTrail());
    const fakeFetch = (async (url: string) => {
      if (String(url).includes('allowed.local')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('nope', { status: 403 });
    }) as typeof fetch;
    reg.register(createHttpTool(fakeFetch, ['allowed.local']));
    const okRes = await reg.execute('http:request', { method: 'GET', url: 'https://api.allowed.local/x' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(okRes.result.ok).toBe(true);
    const bad = await reg.execute('http:request', { method: 'GET', url: 'https://evil.example.com/x' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    expect(bad.result.ok).toBe(false);
    expect(bad.result.error).toContain('allowlist');
  });

  it('redacts secrets in audit arguments', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'tdx-http-'));
    const { reg, at } = makeRegistry(ws);
    // audit sanitization is applied on every recorded call
    await reg.execute('db:select', { table: 't', apiKey: 'sk-should-not-leak' }, { agentId: 'a', modelId: 'm', workspaceRoot: ws });
    const entry = at.query({ limit: 50 }).find((e) => e.arguments.apiKey !== undefined);
    expect(entry?.arguments.apiKey).toBe('[redacted]');
  });
});
