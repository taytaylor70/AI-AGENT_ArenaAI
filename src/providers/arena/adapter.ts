/**
 * ArenaAdapter — the Arena compatibility layer.
 *
 * Arena is NOT the harness. It is one of the harness's model/evaluation
 * ecosystems: every model on the Arena leaderboard can be routed through
 * this single adapter, alongside OpenAI, Anthropic, Google, Mistral,
 * Groq, xAI, OpenRouter, custom and local providers.
 */

import type {
  CostEstimate,
  ModelAdapter,
  ModelEvent,
  ModelRequest,
  ModelResponse,
  TokenUsage,
} from '../../types.js';
import { ARENA_API_BASE, type ArenaModelEntry } from './model-registry.js';

export interface ArenaAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Native model entries (from the registry or a live leaderboard). */
  models: ArenaModelEntry[];
  fetchImpl?: typeof fetch;
  /** ms multiplier applied to simulated latency (tests). */
  latencyScale?: number;
}

interface ArenaChatChunk {
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export class ArenaAdapter implements ModelAdapter {
  readonly id = 'arena';
  readonly provider = 'arena';
  readonly capabilities = { contextLength: 1_000_000, vision: true, tools: true, structuredOutput: true, streaming: true };
  readonly models: string[];
  private apiKey?: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private byModel = new Map<string, ArenaModelEntry>();

  constructor(opts: ArenaAdapterOptions) {
    this.apiKey = opts.apiKey ?? process.env.TDX_ARENA_API_KEY;
    this.baseUrl = opts.baseUrl ?? ARENA_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.models = opts.models.map((m) => m.model);
    for (const m of opts.models) this.byModel.set(m.model, m);
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  private entry(model: string): ArenaModelEntry {
    const e = this.byModel.get(model);
    if (!e) throw new Error(`ArenaAdapter: unknown model "${model}"`);
    return e;
  }

  private async request(model: string, body: Record<string, unknown>, stream: boolean): Promise<Response> {
    if (!this.configured) {
      throw new Error(
        `ArenaAdapter requires an API key (set TDX_ARENA_API_KEY). ` +
          `Model "${model}" is listed on the Arena leaderboard but is not executable without one.`,
      );
    }
    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        'x-arena-client': 'taylor-dynasty-harness/0.1',
      },
      body: JSON.stringify({ model, stream, ...body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Arena API ${res.status}: ${text.slice(0, 300)}`);
    }
    return res;
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const entry = this.entry(req.model);
    const res = await this.request(req.model, {
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: req.tools?.length
        ? req.tools.map((t) => ({ type: 'function', function: t }))
        : undefined,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
    }, false);
    const body = (await res.json()) as ArenaChatChunk & {
      id?: string;
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }>;
    };
    const choice = body.choices?.[0];
    const toolCalls = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParse(tc.function.arguments),
    }));
    const usage: TokenUsage = {
      inputTokens: body.usage?.prompt_tokens ?? estimateInput(req.messages),
      outputTokens: body.usage?.completion_tokens ?? estimateOutput(choice?.message?.content ?? ''),
    };
    return {
      id: body.id ?? `arena_${Date.now()}`,
      model: req.model,
      content: choice?.message?.content ?? '',
      toolCalls,
      usage,
      finishReason: toolCalls.length ? 'tool_calls' : (choice?.finish_reason === 'length' ? 'length' : 'stop'),
      latencyMs: Date.now() - started,
      raw: { entry: entry.model },
    };
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    const res = await this.request(req.model, {
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
    }, true);
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of raw.split('\n')) {
          const data = line.replace(/^data:\s?/, '').trim();
          if (!data || data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data) as ArenaChatChunk;
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) yield { type: 'delta', text: delta };
            if (chunk.usage) {
              yield {
                type: 'usage',
                usage: {
                  inputTokens: chunk.usage.prompt_tokens ?? 0,
                  outputTokens: chunk.usage.completion_tokens ?? 0,
                },
              };
            }
          } catch {
            /* partial frame — ignore */
          }
        }
      }
    }
    yield { type: 'done' };
  }

  /**
   * Arena is a multi-model gateway, so per-model precision lives in the
   * harness catalog. This estimate uses the median-priced entry as a
   * representative figure; callers needing exact figures use
   * `HarnessModel.pricing` from the catalog.
   */
  estimateCost(usage: TokenUsage): CostEstimate {
    const prices = [...this.byModel.values()].map((e) => e.pricing);
    const mid = prices.sort(
      (a, b) => a.inputPerM + a.outputPerM - (b.inputPerM + b.outputPerM),
    )[Math.floor(prices.length / 2)] ?? { inputPerM: 1, outputPerM: 4 };
    const input = (usage.inputTokens / 1e6) * mid.inputPerM;
    const output = (usage.outputTokens / 1e6) * mid.outputPerM;
    return { input, output, total: input + output, currency: 'USD' };
  }

  /** Exact pricing for a specific native model served by this adapter. */
  costFor(model: string, usage: TokenUsage): CostEstimate {
    const pricing = this.byModel.get(model)?.pricing ?? { inputPerM: 1, outputPerM: 4 };
    const input = (usage.inputTokens / 1e6) * pricing.inputPerM;
    const output = (usage.outputTokens / 1e6) * pricing.outputPerM;
    return { input, output, total: input + output, currency: 'USD' };
  }
}

function estimateInput(messages: Array<{ content: string }>): number {
  return Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
}

function estimateOutput(text: string): number {
  return Math.ceil(text.length / 4);
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
