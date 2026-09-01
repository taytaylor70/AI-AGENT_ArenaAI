import { HttpProviderAdapter, type HttpProviderOptions } from '../http-provider.js';
import { getArenaEntry } from '../arena/model-registry.js';
import type { ProviderModelDef } from '../http-provider.js';

/**
 * Direct OpenAI provider. Models appear here AND on the Arena leaderboard —
 * the harness can route to either path (`openai:gpt-5.6` vs `arena:gpt-5.6`).
 */
const IDS = ['gpt-5.6', 'gpt-5.6-mini'];

function defs(): ProviderModelDef[] {
  return IDS.map((id) => {
    const e = getArenaEntry('openai', id);
    return {
      model: id,
      displayName: e?.displayName ?? id,
      pricing: e?.pricing ?? { inputPerM: 1, outputPerM: 4 },
      contextLength: e?.capabilities.contextLength ?? 200_000,
      vision: e?.capabilities.vision ?? true,
    };
  });
}

export function createOpenAIAdapter(opts: Partial<HttpProviderOptions> = {}) {
  return new HttpProviderAdapter({
    provider: 'openai',
    adapterId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: defs(),
    resolveApiKey: () => process.env.OPENAI_API_KEY,
    ...opts,
  });
}
