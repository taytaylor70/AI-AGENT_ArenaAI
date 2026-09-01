/**
 * Anthropic provider — Messages API wire format.
 */

import type {
  ChatMessage,
  CostEstimate,
  ModelAdapter,
  ModelEvent,
  ModelRequest,
  ModelResponse,
  TokenUsage,
} from '../../types.js';
import { estimateInput, estimateOutput, price } from '../http-provider.js';
import { getArenaEntry } from '../arena/model-registry.js';
import type { ProviderModelDef } from '../http-provider.js';

const IDS = ['claude-opus-4.5', 'claude-sonnet-4.5', 'claude-haiku-4.5'];

function defs(): ProviderModelDef[] {
  return IDS.map((id) => {
    const e = getArenaEntry('anthropic', id);
    return {
      model: id,
      displayName: e?.displayName ?? id,
      pricing: e?.pricing ?? { inputPerM: 3, outputPerM: 15 },
      contextLength: e?.capabilities.contextLength ?? 200_000,
      vision: e?.capabilities.vision ?? true,
    };
  });
}

export interface AnthropicAdapterOptions {
  baseUrl?: string;
  resolveApiKey?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  id?: string;
  content?: AnthropicBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export class AnthropicAdapter implements ModelAdapter {
  readonly id = 'anthropic';
  readonly provider = 'anthropic';
  readonly capabilities = { contextLength: 1_000_000, vision: true, tools: true, structuredOutput: true, streaming: true };
  readonly models: string[];
  private baseUrl: string;
  private resolveApiKey: () => string | undefined;
  private fetchImpl: typeof fetch;
  private defs = new Map<string, ProviderModelDef>();

  constructor(opts: AnthropicAdapterOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com';
    this.resolveApiKey = opts.resolveApiKey ?? (() => process.env.ANTHROPIC_API_KEY);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const ds = defs();
    this.models = ds.map((d) => d.model);
    for (const d of ds) this.defs.set(d.model, d);
  }

  get configured(): boolean {
    return Boolean(this.resolveApiKey());
  }

  private key(): string {
    const key = this.resolveApiKey();
    if (!key) throw new Error('anthropic: no API key configured (vault or environment)');
    return key;
  }

  private body(req: ModelRequest): Record<string, unknown> {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const messages = req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
    return {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      system: system || undefined,
      messages,
      temperature: req.temperature,
    };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.key(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.body(req)),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as AnthropicResponse;
    const blocks = json.content ?? [];
    const content = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const toolCalls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id ?? `anth_${Date.now()}`, name: b.name ?? 'unknown', arguments: b.input ?? {} }));
    const usage: TokenUsage = {
      inputTokens: json.usage?.input_tokens ?? estimateInput(req.messages),
      outputTokens: json.usage?.output_tokens ?? estimateOutput(content),
    };
    return {
      id: json.id ?? `anth_${Date.now()}`,
      model: req.model,
      content,
      toolCalls,
      usage,
      finishReason: toolCalls.length ? 'tool_calls' : json.stop_reason === 'max_tokens' ? 'length' : 'stop',
      latencyMs: Date.now() - started,
    };
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages?stream=true`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.key(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.body(req)),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
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
          if (!line.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim()) as {
              type?: string;
              delta?: { type?: string; text?: string };
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              yield { type: 'delta', text: evt.delta.text };
            }
            if (evt.usage) {
              yield {
                type: 'usage',
                usage: {
                  inputTokens: evt.usage.input_tokens ?? 0,
                  outputTokens: evt.usage.output_tokens ?? 0,
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
    const mid = defs.sort((a, b) => a.pricing.inputPerM - b.pricing.inputPerM)[Math.floor(defs.length / 2)];
    return price(usage, mid?.pricing ?? { inputPerM: 3, outputPerM: 15 });
  }
}
