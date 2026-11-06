import { AIError, PROVIDER_META, type ChatOpts, type ChatTurn, type ImagePart, type ProviderAdapter, type VisionOpts } from './types';
import { sseLines } from './stream';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/**
 * Claude via the Messages API, called straight from the browser.
 *
 * `anthropic-dangerous-direct-browser-access` is what makes that possible —
 * without it the request is blocked by CORS before it leaves the page. It is
 * the supported bring-your-own-key path; the key stays on the user's device
 * and is sent only to Anthropic.
 */
export function createAnthropic(apiKey: string, model?: string): ProviderAdapter {
  const chosen = model || PROVIDER_META.anthropic.defaultModel;

  function headers() {
    if (!apiKey) throw new AIError('No Anthropic API key set', 'no-key');
    return {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  async function raise(res: Response): Promise<never> {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {
      /* body wasn't JSON; the status alone will have to do */
    }
    if (res.status === 401 || res.status === 403) {
      throw new AIError(detail || 'Invalid API key', 'auth', res.status);
    }
    if (res.status === 429) throw new AIError(detail || 'Rate limited', 'rate-limit', 429);
    throw new AIError(detail || `Request failed (${res.status})`, 'unknown', res.status);
  }

  /**
   * Note on parameters: this model family rejects `temperature`, `top_p` and
   * `budget_tokens` outright, so none are sent. Depth is controlled with
   * `output_config.effort` instead.
   */
  function body(opts: ChatOpts, extra: Record<string, unknown>) {
    return JSON.stringify({
      model: chosen,
      max_tokens: opts.maxTokens ?? 2048,
      output_config: { effort: opts.light ? 'low' : 'medium' },
      ...(opts.system ? { system: opts.system } : {}),
      ...extra,
    });
  }

  return {
    id: 'anthropic',
    label: PROVIDER_META.anthropic.label,

    async *chat(messages: ChatTurn[], opts: ChatOpts = {}) {
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: headers(),
          signal: opts.signal,
          body: body(opts, { stream: true, messages }),
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

        let evt: {
          type?: string;
          delta?: { type?: string; text?: string };
          stop_reason?: string;
        };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue; // partial frame; the reader will deliver the rest
        }

        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          yield evt.delta.text ?? '';
        }
        // Safety classifiers return HTTP 200 with stop_reason "refusal" — it is
        // not an error status, so it has to be caught here.
        if (evt.type === 'message_delta' && evt.delta && 'stop_reason' in evt.delta) {
          const reason = (evt.delta as { stop_reason?: string }).stop_reason;
          if (reason === 'refusal') throw new AIError('Model declined the request', 'refused');
        }
      }
    },

    async vision(images: ImagePart[], prompt: string, opts: VisionOpts = {}) {
      return callOnce(images, prompt, opts);
    },

    async extract(prompt: string, opts: VisionOpts = {}) {
      return callOnce([], prompt, opts);
    },
  };

  async function callOnce(images: ImagePart[], prompt: string, opts: VisionOpts) {
    const content = [
      ...images.map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
      })),
      { type: 'text' as const, text: prompt },
    ];

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: headers(),
        signal: opts.signal,
        body: body(opts, {
          messages: [{ role: 'user', content }],
          ...(opts.schema
            ? {
                output_config: {
                  effort: opts.light ? 'low' : 'medium',
                  format: { type: 'json_schema', schema: opts.schema },
                },
              }
            : {}),
        }),
      });
    } catch (e) {
      if (e instanceof AIError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new AIError('Network request failed', 'network');
    }
    if (!res.ok) await raise(res);

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
    if (data.stop_reason === 'refusal') {
      throw new AIError('Model declined the request', 'refused');
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');

    // Checked before the empty-text case, and again after: hitting the token
    // ceiling either returns nothing at all or returns half an object, and
    // both used to surface as "the reply could not be read" — which sent the
    // user off checking their key for a problem that was only ever a budget.
    if (data.stop_reason === 'max_tokens') {
      throw new AIError(
        `Reply hit the ${opts.maxTokens ?? 2048} token output limit`,
        'truncated',
      );
    }
    if (!text) throw new AIError('Model returned no text', 'bad-response');
    return text;
  }
}
