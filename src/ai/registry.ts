import type { ProviderId, Settings } from '@/types';
import { AIError, PROVIDER_META, keyShapeWarning, type ProviderAdapter } from './types';
import { withDeadline } from './deadline';
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
      return deadlined(createAnthropic(key, model));
    case 'gemini':
      return deadlined(createGemini(key, model));
    case 'openrouter':
      return deadlined(createOpenRouter(key, model));
  }
}

/**
 * Puts a deadline on every one-shot call, for every provider, in one place.
 *
 * Wrapping here rather than at each `fetch` is what makes it true of the whole
 * app: label reading, photo analysis, voice parsing, food generation, insights
 * and plans all reach a model through this function, and every one of them
 * could previously hang forever on a connection that simply stopped answering.
 *
 * `chat` is deliberately left alone. It streams, so a long-running call is the
 * normal case rather than a symptom, and the text arriving on screen is its own
 * progress indicator — a caller that wants to stop it already has the signal to
 * do so.
 */
function deadlined(adapter: ProviderAdapter): ProviderAdapter {
  return {
    ...adapter,
    vision: (images, prompt, opts = {}) =>
      withDeadline((signal) => adapter.vision(images, prompt, { ...opts, signal }), opts.signal),
    extract: (prompt, opts = {}) =>
      withDeadline((signal) => adapter.extract(prompt, { ...opts, signal }), opts.signal),
  };
}

/** Cheap round-trip used by Settings to verify a pasted key actually works. */
export async function testKey(settings: Settings): Promise<{ ok: boolean; detail: string }> {
  // A key of obviously the wrong shape gets diagnosed here rather than sent:
  // the provider would only answer 401, and "rejected" doesn't tell the user
  // that what they pasted was never a key for this provider in the first place.
  const shape = keyShapeWarning(settings.provider, settings.apiKeys[settings.provider] ?? '');
  if (shape) return { ok: false, detail: shape };

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
