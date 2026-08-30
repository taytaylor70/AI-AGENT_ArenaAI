import { HttpProviderAdapter, type ProviderModelDef } from '../http-provider.js';
import { getArenaEntry } from '../arena/model-registry.js';

const IDS = ['mistral-large-3', 'mistral-small-3.2'];

function defs(): ProviderModelDef[] {
  return IDS.map((id) => {
    const e = getArenaEntry('mistral', id);
    return {
      model: id,
      displayName: e?.displayName ?? id,
      pricing: e?.pricing ?? { inputPerM: 0.5, outputPerM: 2 },
      contextLength: e?.capabilities.contextLength ?? 128_000,
      vision: e?.capabilities.vision ?? false,
    };
  });
}

export class MistralAdapter extends HttpProviderAdapter {}

export function createMistralAdapter(
  opts: Partial<ConstructorParameters<typeof MistralAdapter>[0]> = {},
): MistralAdapter {
  return new MistralAdapter({
    provider: 'mistral',
    adapterId: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: defs(),
    resolveApiKey: () => process.env.MISTRAL_API_KEY,
    ...opts,
  } as ConstructorParameters<typeof MistralAdapter>[0]);
}
