/**
 * Tools: fs:read / fs:write / fs:list / fs:delete
 *
 * Sandboxed to `ctx.workspaceRoot` — paths that escape are rejected.
 * `fs:delete` is flagged as a dangerous operation (DELETE) upstream in
 * the approval gate.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Tool, ToolExecutionContext, ToolResult } from '../tool.js';

function safePath(ctx: ToolExecutionContext, p: string): string {
  const root = resolve(ctx.workspaceRoot);
  const target = resolve(root, p);
  if (target !== root && !target.startsWith(root + '/')) {
    throw new Error(`path escapes workspace: ${p}`);
  }
  return target;
}

const base = (name: string, description: string, params: Record<string, { type: 'string' | 'number'; description: string }>): Tool['spec'] => ({
  name,
  description,
  parameters: params,
});

export function createFilesystemTools(): Tool[] {
  return [
    {
      name: 'fs:read',
      spec: base('fs:read', 'Read a file from the workspace.', {
        path: { type: 'string', description: 'Path relative to the workspace root' },
      }),
      async execute(args, ctx): Promise<ToolResult> {
        const p = safePath(ctx, String(args.path ?? ''));
        if (!existsSync(p)) return { ok: false, output: '', error: `no such file: ${args.path}` };
        const s = statSync(p);
        if (s.size > 200_000) return { ok: false, output: '', error: 'file too large (200KB max)' };
        return { ok: true, output: readFileSync(p, 'utf8') };
      },
    },
    {
      name: 'fs:write',
      spec: base('fs:write', 'Write a file in the workspace (creates parent dirs).', {
        path: { type: 'string', description: 'Path relative to the workspace root' },
        content: { type: 'string', description: 'File content' },
      }),
      async execute(args, ctx): Promise<ToolResult> {
        const p = safePath(ctx, String(args.path ?? ''));
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, String(args.content ?? ''));
        return { ok: true, output: `wrote ${p.length > 0 ? Buffer.byteLength(String(args.content ?? '')) : 0} bytes to ${args.path}` };
      },
    },
    {
      name: 'fs:list',
      spec: base('fs:list', 'List directory contents in the workspace.', {
        path: { type: 'string', description: 'Directory relative to the workspace root (default ".")' },
      }),
      async execute(args, ctx): Promise<ToolResult> {
        const p = safePath(ctx, String(args.path ?? '.'));
        if (!existsSync(p) || !statSync(p).isDirectory()) return { ok: false, output: '', error: `no such dir: ${args.path}` };
        return { ok: true, output: readdirSync(p).sort().join('\n') };
      },
    },
    {
      name: 'fs:delete',
      spec: base('fs:delete', 'DELETE a file in the workspace. Dangerous — requires approval.', {
        path: { type: 'string', description: 'Path relative to the workspace root' },
      }),
      async execute(args, ctx): Promise<ToolResult> {
        const p = safePath(ctx, String(args.path ?? ''));
        if (!existsSync(p)) return { ok: false, output: '', error: `no such file: ${args.path}` };
        rmSync(p, { recursive: true });
        return { ok: true, output: `deleted ${args.path}` };
      },
    },
  ];
}

export { join as _join };
