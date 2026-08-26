import type { ProviderId } from '@/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ImagePart {
  /** Base64 payload without the data: prefix. */
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface ChatOpts {
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Cheaper/faster path for short structured work. */
  light?: boolean;
}

export interface VisionOpts extends ChatOpts {
  /** JSON Schema the reply must satisfy. */
  schema?: Record<string, unknown>;
  schemaName?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** Streams assistant text as it arrives. */
  chat(messages: ChatTurn[], opts?: ChatOpts): AsyncIterable<string>;
  /** One-shot call with images; returns raw text (JSON when a schema is given). */
  vision(images: ImagePart[], prompt: string, opts?: VisionOpts): Promise<string>;
  /** Text-only structured extraction — same contract, no images. */
  extract(prompt: string, opts?: VisionOpts): Promise<string>;
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly kind: 'no-key' | 'auth' | 'rate-limit' | 'network' | 'refused' | 'bad-response' | 'unknown' = 'unknown',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

const trimPeriod = (s: string) => s.trim().replace(/\.$/, '');

/** Turns any thrown value into a message worth showing a user. */
export function describeError(err: unknown): string {
  if (err instanceof AIError) {
    switch (err.kind) {
      case 'no-key':
        return 'Add an API key in Settings to use this.';
      case 'auth':
        // The provider's own wording ("No auth credentials found", "User not
        // found", quota messages) is the only thing that says *why* it was
        // rejected. Dropping it left users staring at a dead end, so it is
        // passed through whenever there is one.
        return err.message
          ? `That API key was rejected — ${trimPeriod(err.message)}.`
          : 'That API key was rejected. Check it in Settings.';
      case 'rate-limit':
        return 'The provider is rate-limiting requests. Try again shortly.';
      case 'network':
        return 'Could not reach the provider. Check your connection.';
      case 'refused':
        return 'The model declined to answer that.';
      case 'bad-response':
        return "The model's reply could not be read. Try again.";
      default:
        return err.message || 'Something went wrong.';
    }
  }
  if (err instanceof DOMException && err.name === 'AbortError') return 'Cancelled.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export const PROVIDER_META: Record<
  ProviderId,
  {
    label: string;
    keyUrl: string;
    keyHint: string;
    /** Expected prefix, for catching a paste that clearly isn't this provider's key. */
    keyPrefix?: string;
    /** Shown when the prefix doesn't match — says what a real key looks like. */
    keyShape: string;
    models: string[];
    defaultModel: string;
  }
> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Starts with sk-ant-',
    keyPrefix: 'sk-ant-',
    keyShape: 'Anthropic keys start with sk-ant-',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    defaultModel: 'claude-opus-5',
  },
  gemini: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'From Google AI Studio',
    // Google AI Studio keys start AIza, but Google has shipped other shapes
    // before, so this stays a hint rather than a hard prefix check.
    keyShape: 'Google AI Studio keys usually start with AIza',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
  },
  openrouter: {
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'Starts with sk-or-v1-',
    keyPrefix: 'sk-or-',
    keyShape: 'OpenRouter keys start with sk-or-v1- followed by a long hex string',
    models: [
      'stealth/ox-alpha',
      'anthropic/claude-sonnet-4.5',
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'meta-llama/llama-4-maverick',
    ],
    defaultModel: 'anthropic/claude-sonnet-4.5',
  },
};

/**
 * Catches a key that cannot possibly belong to the selected provider — the
 * common cases being a key pasted under the wrong provider tab, or only part
 * of one copied. Returns null when the key looks plausible.
 *
 * Deliberately advisory rather than blocking: providers do change key formats,
 * and refusing to save a valid new-format key would be worse than a warning.
 */
export function keyShapeWarning(provider: ProviderId, key: string): string | null {
  const value = key.trim();
  if (!value) return null;
  const meta = PROVIDER_META[provider];
  if (!meta.keyPrefix || value.startsWith(meta.keyPrefix)) return null;

  const other = (Object.keys(PROVIDER_META) as ProviderId[]).find(
    (id) => id !== provider && PROVIDER_META[id].keyPrefix && value.startsWith(PROVIDER_META[id].keyPrefix!),
  );
  if (other) {
    // Phrased without an article so provider labels beginning with a vowel
    // don't produce "a Anthropic key".
    return `That looks like a key for ${PROVIDER_META[other].label}, not ${meta.label}. Switch tabs, or paste the right key.`;
  }
  return `${meta.keyShape}. This one starts with "${value.slice(0, 6)}", so it's probably incomplete or from the wrong page.`;
}
