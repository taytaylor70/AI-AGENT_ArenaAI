/**
 * Local models — Ollama.
 *
 * `local:` catalog entries are served by a runtime on this machine
 * (default http://127.0.0.1:11434). No key, no cloud, no cost.
 */

import type {
  CostEstimate,
  ModelAdapter,
  ModelEvent,
  ModelRequest,
  ModelResponse,
  TokenUsage,
} from '../../types.js';
import { estimateInput, estimateOutput } from '../http-provider.js';

export interface OllamaAdapterOptions {
  baseUrl?: string;
  models?: string[];
  fetchImpl?: typeof fetch;
}

interface OllamaResponse {
  message?: { content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaAdapter implements ModelAdapter {
  readonly id = 'local';
  readonly provider = 'local';
  readonly capabilities = { contextLength: 128_000, vision: false, tools: true, structuredOutput: false, streaming: true };
  readonly models: string[];
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(opts: OllamaAdapterOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
    this.models = opts.models ?? ['llama-4-maverick:131b', 'deepseek-v4'];
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  get configured(): boolean {
    return true;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        options: { temperature: req.temperature ?? 0.3 },
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as OllamaResponse;
    const content = json.message?.content ?? '';
    const usage: TokenUsage = {
      inputTokens: json.prompt_eval_count ?? estimateInput(req.messages),
      outputTokens: json.eval_count ?? estimateOutput(content),
    };
    return {
      id: `local_${Date.now()}`,
      model: req.model,
      content,
      toolCalls: [],
      usage,
      finishReason: 'stop',
      latencyMs: Date.now() - started,
    };
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as OllamaResponse;
          if (evt.message?.content) yield { type: 'delta', text: evt.message.content };
          if (evt.done) {
            yield {
              type: 'usage',
              usage: { inputTokens: evt.prompt_eval_count ?? 0, outputTokens: evt.eval_count ?? 0 },
            };
          }
        } catch {
          /* partial frame */
        }
      }
    }
    yield { type: 'done' };
  }

  estimateCost(_usage: TokenUsage): CostEstimate {
    return { input: 0, output: 0, total: 0, currency: 'USD' };
  }
}
