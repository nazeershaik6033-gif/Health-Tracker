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

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

type Content =
  | string
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: Content;
}

export function createOpenRouter(apiKey: string, model?: string): ProviderAdapter {
  const chosen = model || PROVIDER_META.openrouter.defaultModel;

  function headers() {
    if (!apiKey) throw new AIError('No OpenRouter API key set', 'no-key');
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      // OpenRouter attributes traffic with these; both are optional but
      // sending them keeps the app identifiable in the user's dashboard.
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Healthify',
    };
  }

  async function raise(res: Response): Promise<never> {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 || res.status === 403) throw new AIError(detail || 'Invalid API key', 'auth', res.status);
    if (res.status === 429) throw new AIError(detail || 'Rate limited', 'rate-limit', 429);
    throw new AIError(detail || `Request failed (${res.status})`, 'unknown', res.status);
  }

  function build(messages: Msg[], opts: VisionOpts, stream: boolean) {
    return JSON.stringify({
      model: chosen,
      stream,
      max_tokens: opts.maxTokens ?? 2048,
      messages: opts.system
        ? [{ role: 'system' as const, content: opts.system }, ...messages]
        : messages,
      ...(opts.schema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: opts.schemaName ?? 'result',
                strict: true,
                schema: opts.schema,
              },
            },
          }
        : {}),
    });
  }

  return {
    id: 'openrouter',
    label: PROVIDER_META.openrouter.label,

    async *chat(messages: ChatTurn[], opts: ChatOpts = {}) {
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: headers(),
          signal: opts.signal,
          body: build(
            messages.map((m) => ({ role: m.role, content: m.content })),
            opts,
            true,
          ),
        });
      } catch (e) {
        if (e instanceof AIError) throw e;
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new AIError('Network request failed', 'network');
      }
      if (!res.ok) await raise(res);
      if (!res.body) throw new AIError('Empty response stream', 'bad-response');

      for await (const line of sseLines(res.body, opts.signal)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt: { choices?: { delta?: { content?: string }; finish_reason?: string }[] };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) yield delta;
        if (evt.choices?.[0]?.finish_reason === 'content_filter') {
          throw new AIError('Model declined the request', 'refused');
        }
      }
    },

    async vision(images: ImagePart[], prompt: string, opts: VisionOpts = {}) {
      const content: Content = [
        ...images.map((img) => ({
          type: 'image_url' as const,
          image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
        })),
        { type: 'text' as const, text: prompt },
      ];
      return once([{ role: 'user', content }], opts);
    },

    async extract(prompt: string, opts: VisionOpts = {}) {
      return once([{ role: 'user', content: prompt }], opts);
    },
  };

  async function once(messages: Msg[], opts: VisionOpts): Promise<string> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: headers(),
        signal: opts.signal,
        body: build(messages, opts, false),
      });
    } catch (e) {
      if (e instanceof AIError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new AIError('Network request failed', 'network');
    }
    if (!res.ok) await raise(res);

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    if (data.choices?.[0]?.finish_reason === 'content_filter') {
      throw new AIError('Model declined the request', 'refused');
    }
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new AIError('Model returned no text', 'bad-response');
    return text;
  }
}
