import {
  AIError,
  PROVIDER_META,
  type ChatOpts,
  type ChatTurn,
  type ImagePart,
  type ProviderAdapter,
  type VisionOpts,
} from './types';
import { sseLines } from './stream';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  error?: { message?: string; status?: string };
  promptFeedback?: { blockReason?: string };
}

export function createGemini(apiKey: string, model?: string): ProviderAdapter {
  const chosen = model || PROVIDER_META.gemini.defaultModel;

  function guard() {
    if (!apiKey) throw new AIError('No Gemini API key set', 'no-key');
  }

  async function raise(res: Response): Promise<never> {
    let detail = '';
    try {
      const body = (await res.json()) as GeminiResponse;
      detail = body.error?.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 400 && /API key/i.test(detail)) {
      throw new AIError(detail, 'auth', 400);
    }
    if (res.status === 401 || res.status === 403) throw new AIError(detail || 'Invalid API key', 'auth', res.status);
    if (res.status === 429) throw new AIError(detail || 'Rate limited', 'rate-limit', 429);
    throw new AIError(detail || `Request failed (${res.status})`, 'unknown', res.status);
  }

  function requestBody(
    parts: GeminiPart[],
    history: ChatTurn[],
    opts: VisionOpts,
  ): string {
    return JSON.stringify({
      contents: [
        // Gemini names the assistant role "model".
        ...history.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        ...(parts.length ? [{ role: 'user', parts }] : []),
      ],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 2048,
        ...(opts.schema
          ? { responseMimeType: 'application/json', responseSchema: toGeminiSchema(opts.schema) }
          : {}),
      },
    });
  }

  return {
    id: 'gemini',
    label: PROVIDER_META.gemini.label,

    async *chat(messages: ChatTurn[], opts: ChatOpts = {}) {
      guard();
      const url = `${BASE}/${chosen}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: opts.signal,
          body: requestBody([], messages, opts),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new AIError('Network request failed', 'network');
      }
      if (!res.ok) await raise(res);
      if (!res.body) throw new AIError('Empty response stream', 'bad-response');

      for await (const line of sseLines(res.body, opts.signal)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt: GeminiResponse;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.promptFeedback?.blockReason) {
          throw new AIError('Model declined the request', 'refused');
        }
        for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) yield part.text;
        }
      }
    },

    async vision(images: ImagePart[], prompt: string, opts: VisionOpts = {}) {
      return once(
        [
          ...images.map((img) => ({
            inlineData: { mimeType: img.mediaType, data: img.base64 },
          })),
          { text: prompt },
        ],
        opts,
      );
    },

    async extract(prompt: string, opts: VisionOpts = {}) {
      return once([{ text: prompt }], opts);
    },
  };

  async function once(parts: GeminiPart[], opts: VisionOpts): Promise<string> {
    guard();
    const url = `${BASE}/${chosen}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: opts.signal,
        body: requestBody(parts, [], opts),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new AIError('Network request failed', 'network');
    }
    if (!res.ok) await raise(res);

    const data = (await res.json()) as GeminiResponse;
    if (data.promptFeedback?.blockReason) {
      throw new AIError('Model declined the request', 'refused');
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    if (!text) throw new AIError('Model returned no text', 'bad-response');
    return text;
  }
}

/**
 * Gemini's schema dialect is OpenAPI-ish: it wants uppercase type names and
 * rejects the JSON Schema keywords we use elsewhere (`additionalProperties`,
 * `$schema`). This converts rather than maintaining two schema copies.
 */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const convert = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(convert);
    if (!node || typeof node !== 'object') return node;

    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(src)) {
      if (key === 'additionalProperties' || key === '$schema') continue;
      if (key === 'type' && typeof value === 'string') {
        out.type = value.toUpperCase();
      } else if (key === 'properties' && value && typeof value === 'object') {
        out.properties = Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, convert(v)]),
        );
      } else {
        out[key] = convert(value);
      }
    }
    return out;
  };
  return convert(schema) as Record<string, unknown>;
}
