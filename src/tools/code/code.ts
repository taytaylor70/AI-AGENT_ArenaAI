/**
 * Tool: code:run
 * Runs JavaScript in an isolated V8 context (node:vm) with a hard
 * timeout and a minimal sandbox. No filesystem or network access from
 * inside the context.
 */

import { createContext, Script } from 'node:vm';
import type { Tool, ToolExecutionContext, ToolResult } from '../tool.js';

export function createCodeTool(timeoutMs = 5000): Tool {
  return {
    name: 'code:run',
    spec: {
      name: 'code:run',
      description: 'Run a JavaScript snippet in an isolated sandbox and capture its console output.',
      parameters: {
        code: { type: 'string', description: 'JavaScript source to execute' },
        timeoutMs: { type: 'number', description: 'Execution limit in ms (default 5000)' },
      },
    },
    async execute(args, _ctx: ToolExecutionContext): Promise<ToolResult> {
      const code = String(args.code ?? '');
      if (!code.trim()) return { ok: false, output: '', error: 'code is required' };
      const limit = Math.min(Number(args.timeoutMs ?? timeoutMs), 15000);
      const out: string[] = [];
      const sandbox = {
        console: {
          log: (...a: unknown[]) => out.push(a.map(String).join(' ')),
          error: (...a: unknown[]) => out.push(`ERR ${a.map(String).join(' ')}`),
        },
        Math,
        JSON,
        Date,
        Promise,
      };
      const ctx = createContext(sandbox);
      try {
        const script = new Script(code, { filename: 'code:run.js' });
        const result = script.runInContext(ctx, { timeout: limit }) as unknown;
        if (result !== undefined) out.push(`=> ${JSON.stringify(result, _r, 2)}`);
        return { ok: true, output: out.join('\n') || '(no output)' };
      } catch (err) {
        return { ok: false, output: out.join('\n'), error: String(err) };
      }
    },
  };
}

function _r(_k: string, v: unknown): unknown {
  return v;
}
