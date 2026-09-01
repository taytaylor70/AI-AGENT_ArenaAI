/**
 * Shared base for direct provider HTTP adapters (OpenAI-compatible wire
 * format). Each concrete provider only contributes its base URL, auth
 * header, and model list. The harness speaks to providers exclusively
 * through the `ModelAdapter` interface.
 *
 * API keys are resolved server-side from the encrypted SecretsVault with
 * an environment fallback. Keys never leave the backend.
 */

import type {
  ChatMessage,
  CostEstimate,
  ModelAdapter,
  ModelEvent,
  ModelPricing,
  ModelRequest,
  ModelResponse,
  TokenUsage,
  ToolCall,
} from '../types.js';

export interface ProviderModelDef {
  model: string;
  displayName: string;
  pricing: ModelPricing;
  contextLength: number;
  vision?: boolean;
  structured?: boolean;
}

export interface HttpProviderOptions {
  provider: string;
  adapterId: string;
  baseUrl: string;
  models: ProviderModelDef[];
  /** Returns the API key (vault -> env fallback). */
  resolveApiKey: () => string | undefined;
  fetchImpl?: typeof fetch;
  /** Extra static headers (e.g. anthropic-version). */
  headers?: Record<string, string>;
}

interface OpenAiChunk {
  id?: string;
  choices?: Array<{
    delta?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class HttpProviderAdapter implements ModelAdapter {
  readonly id: string;
  readonly provider: string;
  readonly capabilities = { contextLength: 128_000, vision: true, tools: true, structuredOutput: true, streaming: true };
  readonly models: string[];
  protected baseUrl: string;
  protected resolveApiKey: () => string | undefined;
  protected fetchImpl: typeof fetch;
  protected extraHeaders: Record<string, string>;
  protected defs = new Map<string, ProviderModelDef>();

  constructor(opts: HttpProviderOptions) {
    this.provider = opts.provider;
    this.id = opts.adapterId;
    this.baseUrl = opts.baseUrl;
    this.resolveApiKey = opts.resolveApiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.extraHeaders = opts.headers ?? {};
    this.models = opts.models.map((m) => m.model);
    for (const m of opts.models) this.defs.set(m.model, m);
  }

  get configured(): boolean {
    return Boolean(this.resolveApiKey());
  }

  protected authHeaders(): Record<string, string> {
    const key = this.resolveApiKey();
    if (!key) throw new Error(`${this.provider}: no API key configured (vault or environment)`);
    return { authorization: `Bearer ${key}`, ...this.extraHeaders };
  }

  /** Map harness messages to the provider wire format. */
  protected mapMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  protected url(_model: string, _stream: boolean): string {
    return `${this.baseUrl}/chat/completions`;
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.mapMessages(req.messages),
      temperature: req.temperature,
      stream: false,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    const res = await this.fetchImpl(this.url(req.model, false), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${this.provider} ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as OpenAiChunk & {
      id?: string;
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>;
    };
    const choice = json.choices?.[0];
    const rawCalls = choice?.message?.tool_calls ?? [];
    const toolCalls: ToolCall[] = rawCalls.map((tc, i) => ({
      id: tc.id ?? `${this.provider}_tc_${i}`,
      name: tc.function?.name ?? 'unknown',
      arguments: safeParse(tc.function?.arguments ?? '{}'),
    }));
    const usage: TokenUsage = {
      inputTokens: json.usage?.prompt_tokens ?? estimateInput(req.messages),
      outputTokens: json.usage?.completion_tokens ?? estimateOutput(choice?.message?.content ?? ''),
    };
    return {
      id: json.id ?? `${this.provider}_${Date.now()}`,
      model: req.model,
      content: choice?.message?.content ?? '',
      toolCalls,
      usage,
      finishReason: toolCalls.length ? 'tool_calls' : choice?.finish_reason === 'length' ? 'length' : 'stop',
      latencyMs: Date.now() - started,
    };
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.mapMessages(req.messages),
      temperature: req.temperature,
      stream: true,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    const res = await this.fetchImpl(this.url(req.model, true), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${this.provider} ${res.status}: ${text.slice(0, 300)}`);
    }
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
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          const data = line.replace(/^data:\s?/, '').trim();
          if (!data || data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data) as OpenAiChunk;
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) yield { type: 'delta', text: delta.content };
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
            /* partial frame */
          }
        }
      }
    }
    yield { type: 'done' };
  }

  estimateCost(usage: TokenUsage): CostEstimate {
    const defs = [...this.defs.values()];
    const mid = defs.sort((a, b) => (a.pricing.inputPerM + a.pricing.outputPerM) - (b.pricing.inputPerM + b.pricing.outputPerM))[Math.floor(defs.length / 2)]
      ?? { pricing: { inputPerM: 1, outputPerM: 4 } };
    return price(usage, mid.pricing);
  }
}

export function price(usage: TokenUsage, p: ModelPricing): CostEstimate {
  const input = (usage.inputTokens / 1e6) * p.inputPerM;
  const output = (usage.outputTokens / 1e6) * p.outputPerM;
  return { input, output, total: input + output, currency: 'USD' };
}

export function estimateInput(messages: Array<{ content: string }>): number {
  return Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
}

export function estimateOutput(text: string): number {
  return Math.ceil(text.length / 4);
}

export function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
