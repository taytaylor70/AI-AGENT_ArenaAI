/**
 * Tool: http:request — outbound HTTP (GET/POST) with a 10s timeout.
 * Optionally restricted to an allowlist of domains.
 */

import type { Tool, ToolExecutionContext, ToolResult } from '../tool.js';

export function createHttpTool(fetchImpl: typeof fetch = globalThis.fetch, allowedDomains?: string[]): Tool {
  return {
    name: 'http:request',
    spec: {
      name: 'http:request',
      description: 'Send an HTTP GET or POST request and return the response body (truncated).',
      parameters: {
        method: { type: 'string', description: 'GET or POST', enum: ['GET', 'POST'] },
        url: { type: 'string', description: 'Absolute http(s) URL' },
        body: { type: 'string', description: 'POST body (optional)' },
      },
    },
    async execute(args, _ctx: ToolExecutionContext): Promise<ToolResult> {
      const url = String(args.url ?? '');
      const method = String(args.method ?? 'GET').toUpperCase();
      if (!/^https?:\/\//i.test(url)) return { ok: false, output: '', error: 'url must be http(s)' };
      if (method !== 'GET' && method !== 'POST') return { ok: false, output: '', error: 'method must be GET or POST' };
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        return { ok: false, output: '', error: 'invalid url' };
      }
      if (allowedDomains && !allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
        return { ok: false, output: '', error: `domain "${host}" not in allowlist` };
      }
      try {
        const res = await fetchImpl(url, {
          method,
          headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
          body: method === 'POST' ? String(args.body ?? '') : undefined,
          signal: AbortSignal.timeout(10000),
        });
        const text = await res.text();
        return { ok: res.ok, output: `HTTP ${res.status}\n${text.slice(0, 4000)}` };
      } catch (err) {
        return { ok: false, output: '', error: String(err) };
      }
    },
  };
}
