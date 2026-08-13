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

export type AIErrorKind =
  | 'no-key'
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'refused'
  /** The model hit its output budget before finishing. Retryable with more. */
  | 'truncated'
  | 'bad-response'
  | 'unknown';

export class AIError extends Error {
  constructor(
    message: string,
    readonly kind: AIErrorKind = 'unknown',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

/**
 * Errors a second attempt cannot fix. A repair pass on any of these just makes
 * the user wait twice as long for the same message — the request never reached
 * a model, or the model deliberately refused.
 */
export const UNREPAIRABLE: ReadonlySet<AIErrorKind> = new Set<AIErrorKind>([
  'no-key',
  'auth',
  'refused',
  'network',
  'rate-limit',
]);

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
      case 'truncated':
        // Distinct from bad-response on purpose: this one is not a garbled
        // reply, it is a complete reply that never finished being written, and
        // "try again" alone has no reason to do better.
        return 'The model ran out of room before finishing. Try a simpler photo, or a model with a larger output limit.';
      case 'bad-response':
        return "The model's reply could not be read. Try again.";
      default:
        return err.message || 'Something went wrong.';
    }
  }
  if (err instanceof DOMException && err.name === 'AbortError') return 'Cancelled.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/**
 * The technical detail behind a failure, for the line under the friendly
 * message.
 *
 * `describeError` deliberately says things like "the model's reply could not be
 * read" — right for the user, useless for working out *why*. Without the
 * provider, the model id and the HTTP status there is nothing to act on and
 * nothing to report, which is how a broken Snap stays broken.
 */
export function errorDetail(err: unknown, provider: string, model: string): string {
  const parts = [provider, model];
  if (err instanceof AIError) {
    if (err.status) parts.push(`HTTP ${err.status}`);
    parts.push(err.kind);
    if (err.message) parts.push(err.message);
  } else if (err instanceof Error) {
    parts.push(err.message);
  }
  return parts.filter(Boolean).join(' · ');
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
