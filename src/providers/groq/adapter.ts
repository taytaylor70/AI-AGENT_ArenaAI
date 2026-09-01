import { HttpProviderAdapter, type ProviderModelDef } from '../http-provider.js';
import { getArenaEntry } from '../arena/model-registry.js';

const IDS = ['grok-4.1-groq'];

function defs(): ProviderModelDef[] {
  // Groq hosts high-throughput open models; the flagship route for grok is
  // xAI, but Groq's open catalog (llama-4-maverick etc.) is exposed here.
  return ['meta-llama/llama-4-maverick', 'deepseek/deepseek-v4'].map((id) => {
    const [prov, model] = id.includes('/') ? id.split('/') : ['meta-llama', id];
    const e = getArenaEntry(prov, model);
    return {
      model: id,
      displayName: e?.displayName ?? id,
      pricing: e?.pricing ?? { inputPerM: 0.2, outputPerM: 0.8 },
      contextLength: e?.capabilities.contextLength ?? 128_000,
      vision: e?.capabilities.vision ?? false,
    };
  });
}

export class GroqAdapter extends HttpProviderAdapter {}

export function createGroqAdapter(
  opts: Partial<ConstructorParameters<typeof GroqAdapter>[0]> = {},
): GroqAdapter {
  return new GroqAdapter({
    provider: 'groq',
    adapterId: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: defs(),
    resolveApiKey: () => process.env.GROQ_API_KEY,
    ...opts,
  } as ConstructorParameters<typeof GroqAdapter>[0]);
}
