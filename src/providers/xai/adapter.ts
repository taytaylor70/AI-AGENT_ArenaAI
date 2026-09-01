import { HttpProviderAdapter, type ProviderModelDef } from '../http-provider.js';
import { getArenaEntry } from '../arena/model-registry.js';

const IDS = ['grok-4.1', 'grok-4.1-fast'];

function defs(): ProviderModelDef[] {
  return IDS.map((id) => {
    const e = getArenaEntry('xai', id);
    return {
      model: id,
      displayName: e?.displayName ?? id,
      pricing: e?.pricing ?? { inputPerM: 3, outputPerM: 15 },
      contextLength: e?.capabilities.contextLength ?? 256_000,
      vision: e?.capabilities.vision ?? true,
    };
  });
}

export class XaiAdapter extends HttpProviderAdapter {}

export function createXaiAdapter(opts: Partial<ConstructorParameters<typeof XaiAdapter>[0]> = {}): XaiAdapter {
  return new XaiAdapter({
    provider: 'xai',
    adapterId: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    models: defs(),
    resolveApiKey: () => process.env.XAI_API_KEY,
    ...opts,
  } as ConstructorParameters<typeof XaiAdapter>[0]);
}
