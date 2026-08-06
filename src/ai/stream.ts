/**
 * Line reader for SSE bodies.
 *
 * Chunk boundaries fall wherever the network puts them, so a naive
 * `chunk.split('\n')` will split JSON frames in half. This buffers until a
 * newline actually arrives and flushes any trailing partial at the end.
 */
export async function* sseLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line) yield line;
      }
    }
    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

/**
 * Reads a stream of concatenated JSON arrays/objects, as Gemini's
 * streamGenerateContent returns. It is not SSE unless `alt=sse` is set, so we
 * ask for SSE and reuse the line reader — this helper covers the fallback.
 */
export async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}
