/**
 * Tool: browser:fetch
 * Headless page fetch — downloads a page and returns its text content.
 * (Full browser automation would plug in here behind the same Tool
 * interface; the harness does not care.)
 */

import type { Tool, ToolExecutionContext, ToolResult } from '../tool.js';

export function createBrowserTool(fetchImpl: typeof fetch = globalThis.fetch): Tool {
  return {
    name: 'browser:fetch',
    spec: {
      name: 'browser:fetch',
      description: 'Fetch a web page and extract its readable text.',
      parameters: {
        url: { type: 'string', description: 'Absolute http(s) URL' },
        maxChars: { type: 'number', description: 'Max characters to return (default 4000)' },
      },
    },
    async execute(args, _ctx: ToolExecutionContext): Promise<ToolResult> {
      const url = String(args.url ?? '');
      if (!/^https?:\/\//i.test(url)) return { ok: false, output: '', error: 'url must be http(s)' };
      const maxChars = Number(args.maxChars ?? 4000);
      try {
        const res = await fetchImpl(url, {
          headers: { 'user-agent': 'taylor-dynasty-harness/0.1' },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return { ok: false, output: '', error: `HTTP ${res.status}` };
        const ct = res.headers.get('content-type') ?? '';
        const body = await res.text();
        const text = ct.includes('html')
          ? body
              .replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
          : body.trim();
        return { ok: true, output: text.slice(0, maxChars) || '(empty page)' };
      } catch (err) {
        return { ok: false, output: '', error: String(err) };
      }
    },
  };
}
