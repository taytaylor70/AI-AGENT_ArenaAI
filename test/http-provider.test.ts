import { describe, expect, it } from 'vitest';
import { createOpenAIAdapter } from '../src/providers/openai/adapter.js';
import { AnthropicAdapter } from '../src/providers/anthropic/adapter.js';

function sse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('OpenAI-compatible provider adapter', () => {
  const adapter = createOpenAIAdapter({
    resolveApiKey: () => 'sk-test',
    fetchImpl: (async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body.stream) {
        return sse('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\ndata: [DONE]\n\n');
      }
      if (body.tools) {
        return new Response(
          JSON.stringify({
            id: 'cmpl_1',
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [{ id: 'tc1', function: { name: 'web:search', arguments: '{"query":"arena"}' } }],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'cmpl_2',
          choices: [{ message: { content: 'Hello from OpenAI!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch,
  });

  it('generates a parsed response with usage and latency', async () => {
    const res = await adapter.generate({ model: 'gpt-5.6', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toBe('Hello from OpenAI!');
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('parses tool calls', async () => {
    const res = await adapter.generate({
      model: 'gpt-5.6',
      messages: [{ role: 'user', content: 'tool please' }],
      tools: [{ name: 'web:search', description: 'd', parameters: { query: { type: 'string', description: 'q' } } }],
    });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].name).toBe('web:search');
    expect(res.toolCalls[0].arguments).toEqual({ query: 'arena' });
    expect(res.finishReason).toBe('tool_calls');
  });

  it('streams deltas and usage', async () => {
    const events = [];
    for await (const e of adapter.stream({ model: 'gpt-5.6', messages: [{ role: 'user', content: 'stream me' }] })) {
      events.push(e);
    }
    const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    expect(text).toBe('Hello');
    expect(events.some((e) => e.type === 'usage' && e.usage?.outputTokens === 5)).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('estimates cost from provider pricing', () => {
    const cost = adapter.estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost.currency).toBe('USD');
    expect(cost.total).toBeGreaterThan(0);
  });

  it('throws a clear error without a key', async () => {
    const noKey = createOpenAIAdapter({ resolveApiKey: () => undefined });
    await expect(noKey.generate({ model: 'gpt-5.6', messages: [] })).rejects.toThrow(/no API key/);
  });
});

describe('Anthropic provider adapter', () => {
  it('maps system messages and tool_use blocks', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const adapter = new AnthropicAdapter({
      resolveApiKey: () => 'sk-ant-test',
      fetchImpl: (async (_input: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: 'msg_1',
            content: [
              { type: 'text', text: 'Hello from Anthropic' },
              { type: 'tool_use', id: 'tu1', name: 'db:select', input: { table: 'users' } },
            ],
            usage: { input_tokens: 42, output_tokens: 9 },
            stop_reason: 'tool_use',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    });
    const res = await adapter.generate({
      model: 'claude-opus-4.5',
      messages: [
        { role: 'system', content: 'You are a coder.' },
        { role: 'user', content: 'check users' },
      ],
    });
    expect(res.content).toBe('Hello from Anthropic');
    expect(res.toolCalls[0].name).toBe('db:select');
    expect(res.toolCalls[0].arguments).toEqual({ table: 'users' });
    expect(res.usage).toEqual({ inputTokens: 42, outputTokens: 9 });
    expect((capturedBody as { system?: string } | null)?.system).toBe('You are a coder.');
    expect((capturedBody as { messages?: unknown[] } | null)?.messages).toHaveLength(1);
  });
});
