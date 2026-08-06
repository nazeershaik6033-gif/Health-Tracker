import type { ProviderId, Settings } from '@/types';
import { AIError, PROVIDER_META, type ProviderAdapter } from './types';
import { createAnthropic } from './anthropic';
import { createGemini } from './gemini';
import { createOpenRouter } from './openrouter';

/** Whether the user has configured a usable key for the selected provider. */
export function hasKey(settings: Settings, provider?: ProviderId): boolean {
  const id = provider ?? settings.provider;
  return Boolean(settings.apiKeys[id]?.trim());
}

export function modelFor(settings: Settings, provider?: ProviderId): string {
  const id = provider ?? settings.provider;
  return settings.models[id]?.trim() || PROVIDER_META[id].defaultModel;
}

/**
 * Builds the adapter for the active provider. Throws a typed `no-key` error
 * rather than returning undefined so every call site surfaces the same
 * "add a key in Settings" message instead of inventing its own.
 */
export function getAdapter(settings: Settings): ProviderAdapter {
  const id = settings.provider;
  const key = settings.apiKeys[id]?.trim() ?? '';
  if (!key) throw new AIError(`No ${PROVIDER_META[id].label} key set`, 'no-key');

  const model = modelFor(settings);
  switch (id) {
    case 'anthropic':
      return createAnthropic(key, model);
    case 'gemini':
      return createGemini(key, model);
    case 'openrouter':
      return createOpenRouter(key, model);
  }
}

/** Cheap round-trip used by Settings to verify a pasted key actually works. */
export async function testKey(settings: Settings): Promise<{ ok: boolean; detail: string }> {
  try {
    const adapter = getAdapter(settings);
    const reply = await adapter.extract('Reply with exactly: OK', {
      maxTokens: 16,
      light: true,
    });
    return reply.toUpperCase().includes('OK')
      ? { ok: true, detail: `Connected to ${modelFor(settings)}` }
      : { ok: true, detail: `Connected, but the model replied "${reply.slice(0, 40)}"` };
  } catch (err) {
    const { describeError } = await import('./types');
    return { ok: false, detail: describeError(err) };
  }
}

export { PROVIDER_META };
