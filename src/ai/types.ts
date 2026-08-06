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

/** Turns any thrown value into a message worth showing a user. */
export function describeError(err: unknown): string {
  if (err instanceof AIError) {
    switch (err.kind) {
      case 'no-key':
        return 'Add an API key in Settings to use this.';
      case 'auth':
        return 'That API key was rejected. Check it in Settings.';
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
  { label: string; keyUrl: string; keyHint: string; models: string[]; defaultModel: string }
> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Starts with sk-ant-',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    defaultModel: 'claude-opus-5',
  },
  gemini: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'From Google AI Studio',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
  },
  openrouter: {
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'Starts with sk-or-',
    models: [
      'anthropic/claude-sonnet-4.5',
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'meta-llama/llama-4-maverick',
    ],
    defaultModel: 'anthropic/claude-sonnet-4.5',
  },
};
