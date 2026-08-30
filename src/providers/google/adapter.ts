/**
 * Google (Gemini) provider — uses Gemini's OpenAI-compatible endpoint.
 */

import {
  HttpProviderAdapter,
  type HttpProviderOptions,
  type ProviderModelDef,
} from '../http-provider.js';
import { getArenaEntry } from '../arena/model-registry.js';

const IDS = ['gemini-3-ultra', 'gemini-3-flash', 'gemini-3-flash-lite'];

function defs(): ProviderModelDef[] {
  return IDS.map((id) => {
    const e = getArenaEntry('google', id);
    return {
      model: id,
      displayName: e?.displayName ?? id,
      pricing: e?.pricing ?? { inputPerM: 1, outputPerM: 4 },
      contextLength: e?.capabilities.contextLength ?? 1_000_000,
      vision: e?.capabilities.vision ?? true,
      structured: e?.capabilities.structuredOutput ?? true,
    };
  });
}

export class GoogleAdapter extends HttpProviderAdapter {
  override url(_model: string, _stream: boolean): string {
    const key = this.resolveApiKey();
    return `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${key ?? ''}`;
  }

  override authHeaders(): Record<string, string> {
    // Auth travels as the ?key= query param on the OpenAI-compat endpoint.
    return { ...this.extraHeaders };
  }
}

export function createGoogleAdapter(opts: Partial<HttpProviderOptions> = {}): GoogleAdapter {
  return new GoogleAdapter({
    provider: 'google',
    adapterId: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: defs(),
    resolveApiKey: () => process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    ...opts,
  });
}
