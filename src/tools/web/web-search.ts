/**
 * Tool: web:search
 *
 * Real search goes through an injectable WebSearchProvider. The default
 * offline provider returns deterministic simulated results so the agent
 * loop works in CI and demos; set TDX_ONLINE=1 to enable HTTP search.
 */

import type { Tool, ToolExecutionContext, ToolResult } from '../tool.js';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  search(query: string): Promise<WebSearchResult[]>;
}

export class SimulatedWebSearchProvider implements WebSearchProvider {
  async search(query: string): Promise<WebSearchResult[]> {
    const q = query.trim().replace(/\s+/g, ' ');
    return [
      {
        title: `${q} — overview (simulated source 1)`,
        url: `https://simulated.local/1?q=${encodeURIComponent(q)}`,
        snippet: `Deterministic simulated result for "${q}". Establishes the core landscape and key terms.`,
      },
      {
        title: `${q} — best practices (simulated source 2)`,
        url: `https://simulated.local/2?q=${encodeURIComponent(q)}`,
        snippet: 'Commonly recommended patterns: iterate on a vertical slice, keep the contract explicit, measure first.',
      },
      {
        title: `${q} — comparison (simulated source 3)`,
        url: `https://simulated.local/3?q=${encodeURIComponent(q)}`,
        snippet: 'Trade-offs across approaches: latency vs cost vs quality, and where each wins.',
      },
    ];
  }
}

export class HttpWebSearchProvider implements WebSearchProvider {
  constructor(private fetchImpl: typeof fetch = globalThis.fetch) {}

  async search(query: string): Promise<WebSearchResult[]> {
    const res = await this.fetchImpl(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'user-agent': 'taylor-dynasty-harness/0.1' }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`web search ${res.status}`);
    const html = await res.text();
    const out: WebSearchResult[] = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < 5) {
      out.push({
        title: stripTags(m[2]),
        url: m[1].replace(/^\/\//, 'https://'),
        snippet: stripTags(m[3]).slice(0, 220),
      });
    }
    return out;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function createWebSearchTool(provider: WebSearchProvider): Tool {
  return {
    name: 'web:search',
    spec: {
      name: 'web:search',
      description: 'Search the web and return top results (title, url, snippet).',
      parameters: {
        query: { type: 'string', description: 'Search query' },
      },
    },
    async execute(args, _ctx: ToolExecutionContext): Promise<ToolResult> {
      const query = String(args.query ?? '').trim();
      if (!query) return { ok: false, output: '', error: 'query is required' };
      try {
        const results = await provider.search(query);
        if (results.length === 0) return { ok: true, output: 'No results.' };
        return {
          ok: true,
          output: results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
            .join('\n'),
        };
      } catch (err) {
        return { ok: false, output: '', error: String(err) };
      }
    },
  };
}
