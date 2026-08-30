import { HttpProviderAdapter, type ProviderModelDef } from '../http-provider.js';
import { getArenaEntry } from '../arena/model-registry.js';

/**
 * OpenRouter — one key, hundreds of models (open-source and proprietary).
 * Model ids keep their upstream "vendor/model" naming.
 */
const IDS = [
  'qwen/qwen3-max',
  'deepseek/deepseek-v4',
  'deepseek/deepseek-v4-lite',
  'meta-llama/llama-4-maverick',
  'meta-llama/llama-4-scout',
  'qwen/qwen3-coder-480b',
];

function defs(): ProviderModelDef[] {
  return IDS.map((id) => {
    const [prov, model] = id.includes('/') ? id.split('/') : ['unknown', id];
    const e = getArenaEntry(prov, model);
    return {
      model: id,
      displayName: e?.displayName ?? id,
      pricing: e?.pricing ?? { inputPerM: 0.5, outputPerM: 2 },
      contextLength: e?.capabilities.contextLength ?? 128_000,
      vision: e?.capabilities.vision ?? false,
      structured: e?.capabilities.structuredOutput ?? false,
    };
  });
}

export class OpenRouterAdapter extends HttpProviderAdapter {}

export function createOpenRouterAdapter(
  opts: Partial<ConstructorParameters<typeof OpenRouterAdapter>[0]> = {},
): OpenRouterAdapter {
  return new OpenRouterAdapter({
    provider: 'openrouter',
    adapterId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: defs(),
    resolveApiKey: () => process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://taylor-dynasty.local', 'X-Title': 'Taylor Dynasty Agent Harness' },
    ...opts,
  } as ConstructorParameters<typeof OpenRouterAdapter>[0]);
}
