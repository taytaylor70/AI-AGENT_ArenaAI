/**
 * Tool: shell:exec
 * Runs a shell command inside the workspace with a timeout and capped
 * output. Dangerous command shapes (sudo, rm -rf /, mkfs, curl|sh, ...)
 * are flagged by the approval gate BEFORE this executes.
 */

import { exec as execCb } from 'node:child_process';
import type { Tool, ToolExecutionContext, ToolResult } from '../tool.js';

export function createShellTool(timeoutMs = 30000): Tool {
  return {
    name: 'shell:exec',
    spec: {
      name: 'shell:exec',
      description: 'Run a shell command in the workspace and return stdout/stderr.',
      parameters: {
        command: { type: 'string', description: 'Shell command line' },
        timeoutMs: { type: 'number', description: 'Limit in ms (default 30000)' },
      },
    },
    execute(args, ctx): Promise<ToolResult> {
      const command = String(args.command ?? '');
      if (!command.trim()) return Promise.resolve({ ok: false, output: '', error: 'command is required' });
      const limit = Math.min(Number(args.timeoutMs ?? timeoutMs), 120000);
      return new Promise<ToolResult>((resolvePromise) => {
        execCb(command, {
          cwd: ctx.workspaceRoot,
          timeout: limit,
          maxBuffer: 1_000_000,
          signal: ctx.signal,
        }, (err, stdout, stderr) => {
          const output = [stdout, stderr].filter(Boolean).join('\n').slice(0, 20_000);
          if (err) {
            resolvePromise({ ok: false, output, error: `exit ${String((err as { code?: unknown }).code ?? 'error')}: ${String(err).slice(0, 200)}` });
          } else {
            resolvePromise({ ok: true, output: output || '(no output)' });
          }
        });
      });
    },
  };
}
