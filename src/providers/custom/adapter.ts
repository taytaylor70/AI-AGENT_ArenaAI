/**
 * Custom provider adapters.
 *
 *  - `CustomAdapter`: any user-supplied OpenAI-compatible endpoint
 *    (self-hosted gateways, corporate LLM proxies, ...).
 *  - `SimulatedAdapter`: a deterministic, offline "model" that exercises the
 *    full agent loop (tool calls, failures, recovery) for development,
 *    CI and demos without network or API keys. It proves the harness works
 *    end-to-end before any real provider is connected.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import type {
  CostEstimate,
  ModelAdapter,
  ModelCapabilities,
  ModelEvent,
  ModelPricing,
  ModelRequest,
  ModelResponse,
  TokenUsage,
} from '../../types.js';
import { estimateInput, estimateOutput, price } from '../http-provider.js';
import { HttpProviderAdapter, type HttpProviderOptions } from '../http-provider.js';

/* ------------------------------------------------------------------ */
/* Custom (user-supplied endpoint)                                     */
/* ------------------------------------------------------------------ */

export class CustomAdapter extends HttpProviderAdapter {}

export function createCustomAdapter(opts: HttpProviderOptions): CustomAdapter {
  return new CustomAdapter(opts);
}

/* ------------------------------------------------------------------ */
/* Simulated (offline deterministic models)                            */
/* ------------------------------------------------------------------ */

export interface SimModelProfile {
  model: string;
  displayName: string;
  /** 0-100 base quality — drives output completeness. */
  quality: number;
  /** Seconds of simulated p50 latency. */
  speedSeconds: number;
  /** 0-1 probability a tool call is botched (recovery path). */
  toolFailureRate: number;
  pricing: ModelPricing;
  contextLength: number;
}

export const SIM_MODELS: SimModelProfile[] = [
  {
    model: 'atlas',
    displayName: 'Sim Atlas',
    quality: 90,
    speedSeconds: 0.4,
    toolFailureRate: 0.05,
    pricing: { inputPerM: 0.3, outputPerM: 1.2 },
    contextLength: 128_000,
  },
  {
    model: 'obsidian',
    displayName: 'Sim Obsidian',
    quality: 96,
    speedSeconds: 1.6,
    toolFailureRate: 0.02,
    pricing: { inputPerM: 3, outputPerM: 12 },
    contextLength: 1_000_000,
  },
  {
    model: 'herald',
    displayName: 'Sim Herald',
    quality: 76,
    speedSeconds: 0.15,
    toolFailureRate: 0.18,
    pricing: { inputPerM: 0.02, outputPerM: 0.08 },
    contextLength: 32_000,
  },
];

function seededFail(model: string, callIndex: number, rate: number): boolean {
  const h = createHash('sha256').update(`${model}#${callIndex}`).digest();
  return (h[0] / 255) < rate;
}

export interface SimulatedAdapterOptions {
  models?: SimModelProfile[];
  /** 0-1 latency multiplier (default 0.05 → tests stay fast). */
  latencyScale?: number;
  /** Force success on every tool call (deterministic CI mode). */
  noFailures?: boolean;
}

export class SimulatedAdapter implements ModelAdapter {
  readonly id = 'sim';
  readonly provider = 'sim';
  readonly capabilities: ModelCapabilities = {
    contextLength: 1_000_000, vision: true, tools: true, structuredOutput: true, streaming: true,
  };
  readonly models: string[];
  private profiles = new Map<string, SimModelProfile>();
  private latencyScale: number;
  private noFailures: boolean;

  constructor(opts: SimulatedAdapterOptions = {}) {
    const list = opts.models ?? SIM_MODELS;
    this.models = list.map((m) => m.model);
    for (const m of list) this.profiles.set(m.model, m);
    this.latencyScale = opts.latencyScale ?? 0.05;
    this.noFailures = opts.noFailures ?? false;
  }

  get configured(): boolean {
    return true;
  }

  private profile(model: string): SimModelProfile {
    const p = this.profiles.get(model);
    if (!p) throw new Error(`SimulatedAdapter: unknown model "${model}"`);
    return p;
  }

  /**
   * Deterministic brain:
   *  - a USER message carrying a trigger marker (SEARCH:/CODE:/DB:/TEST:)
   *    produces exactly one tool call;
   *  - after a tool result, the model finishes with a final answer;
   *  - reviewer conventions: objectives containing "revision 1" get a
   *    CHANGES list, "revision 2" (or none) get APPROVED.
   */
  private think(model: string, req: ModelRequest, callIndex: number) {
    const last = req.messages[req.messages.length - 1];
    const userText = last?.role === 'user' ? last.content : '';
    // Role marker detection must survive tool rounds: after a tool result the
    // last message is the tool message, so scan the user messages instead.
    const userMsg = req.messages.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '';
    const fail = !this.noFailures && seededFail(model, callIndex, this.profile(model).toolFailureRate);

    if (last?.role !== 'tool') {
      if (/SEARCH:\s*(.+)/.test(userText)) {
        const query = userText.match(/SEARCH:\s*(.+)/)?.[1]?.trim() ?? userText;
        return {
          toolCall: {
            id: `sim_${model}_tc_${callIndex}`,
            name: 'web:search',
            arguments: { query: query.slice(0, 160) },
          },
        };
      }
      if (/CODE:\s*/.test(userText)) {
        return {
          toolCall: {
            id: `sim_${model}_tc_${callIndex}`,
            name: 'code:run',
            arguments: {
              language: 'js',
              code: `// generated by ${model}\nconst result = { ok: true, checksum: ${callIndex * 7 + 3}, note: "artifact produced" };\nconsole.log(JSON.stringify(result));`,
            },
          },
        };
      }
      if (/DB:\s*/.test(userText)) {
        return {
          toolCall: {
            id: `sim_${model}_tc_${callIndex}`,
            name: 'db:select',
            arguments: { table: 'users' },
          },
        };
      }
      if (/TEST:\s*/.test(userText)) {
        return {
          toolCall: {
            id: `sim_${model}_tc_${callIndex}`,
            name: 'shell:exec',
            arguments: { command: `node -e "console.log('PASS 3/3 (simulated suite by ${model})')"` },
          },
        };
      }
    }

    // Final answer. Completeness scales with the model's quality score.
    const p = this.profile(model);
    const hasRevisionMarker = /revision\s+\d+/i.test(userText) || /revision\s+\d+/i.test(userMsg);
    const isReview = /ROLE: reviewer/i.test(userMsg);
    const isQa = /ROLE: qa/i.test(userMsg);
    let content: string;
    if (isQa && last?.role === 'tool') {
      const failed = fail;
      content = failed
        ? 'FAIL: 1 check errored (absorbed — degraded pass). Re-run recommended.'
        : 'PASS: verification suite green (3/3 checks).';
    } else if (isReview) {
      // First pass: strict models may still be satisfied, weak models push
      // back once. After a revision round the changes are addressed.
      content =
        !hasRevisionMarker && p.quality < 93
          ? 'CHANGES: 1) Add input validation on the pricing endpoint. 2) Document the API contract.'
          : 'APPROVED: The artifact is production-ready. Structure, error handling and tests are sound.';
    } else if (last?.role === 'tool') {
      const toolName = last.name ?? 'tool';
      // Delivery phrases scale with quality — the heuristic judge checks
      // these, so stronger models produce more complete artifacts.
      const sections =
        p.quality >= 92
          ? ['Implementation complete', 'Pricing table built', 'Landing page assembled', 'API contract defined', 'Edge cases handled']
          : p.quality >= 85
            ? ['Implementation complete', 'API contract defined', 'Tests specified']
            : ['Implementation complete'];
      content = [
        `Done (${model}).`,
        ...sections.map((s) => `- ${s}`),
        `Tool ${toolName} output incorporated.`,
        fail ? 'WARNING: one tool output was malformed; result is degraded.' : '',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      const n = p.quality >= 92 ? 5 : p.quality >= 85 ? 3 : 2;
      content = [
        `Answer from ${model}.`,
        ...Array.from({ length: n }, (_, i) => `- Point ${i + 1}: derived from the request context.`),
      ].join('\n');
    }
    if (fail && last?.role === 'tool') content += '\n(WARNING: partial tool failure absorbed)';
    return { content, failed: fail && last?.role === 'tool' };
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const p = this.profile(req.model);
    const started = Date.now();
    await delay(p.speedSeconds * 1000 * this.latencyScale);
    const callIndex = req.messages.filter((m) => m.role === 'tool').length;
    const out = this.think(req.model, req, callIndex);
    await delay(p.speedSeconds * 500 * this.latencyScale);
    const usage: TokenUsage = {
      inputTokens: estimateInput(req.messages),
      outputTokens: estimateOutput(out.content ?? ''),
    };
    return {
      id: `sim_${p.model}_${Date.now()}`,
      model: req.model,
      content: out.content ?? '',
      toolCalls: out.toolCall ? [out.toolCall] : [],
      usage,
      finishReason: out.toolCall ? 'tool_calls' : 'stop',
      latencyMs: Date.now() - started,
    };
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    const res = await this.generate(req);
    const words = res.content.split(/(?<=\s)/);
    let usage = res.usage;
    for (let i = 0; i < words.length; i += 4) {
      yield { type: 'delta', text: words.slice(i, i + 4).join('') };
    }
    if (res.toolCalls.length) for (const tc of res.toolCalls) yield { type: 'tool_call', toolCall: tc };
    yield { type: 'usage', usage };
    yield { type: 'done' };
  }

  estimateCost(usage: TokenUsage): CostEstimate {
    const p = this.profiles.values().next().value ?? SIM_MODELS[0];
    return price(usage, p.pricing);
  }
}
