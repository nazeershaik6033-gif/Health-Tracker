import { AIError } from './types';

/**
 * A ceiling on how long a one-shot AI call may stay open.
 *
 * Every adapter threaded the caller's `AbortSignal` into `fetch` and stopped
 * there, which covers a user pressing Cancel and nothing else. A request that
 * is never answered — a stalled socket, a proxy that accepts the connection
 * and then goes quiet, a phone that lost its network mid-upload — leaves the
 * promise pending for as long as the screen is open. The Label reader showed
 * exactly that: "Reading the label…" with no timeout behind it and no cancel
 * in front of it.
 *
 * 75 seconds is deliberately generous. A vision call carrying a full-resolution
 * photo and a couple of thousand output tokens can legitimately run past 30 on
 * a slow connection, and killing a request that was going to succeed is worse
 * than waiting a little longer for one that was not. This is a backstop against
 * *indefinite*, not a latency budget — screens that can afford to give up
 * sooner should pass their own signal.
 */
export const AI_DEADLINE_MS = 75_000;

/**
 * Runs `call` with a signal that aborts either when the caller's own signal
 * does or when the deadline passes, whichever comes first.
 *
 * A timeout is converted into a typed `AIError` rather than left as the bare
 * `AbortError` the fetch throws. The two are indistinguishable at the catch
 * site and mean opposite things to a user: one is "you cancelled this", the
 * other is "the provider never answered". `describeError` renders the first as
 * "Cancelled." — which, for a request that silently died, would be a lie.
 *
 * Composed by hand rather than with `AbortSignal.any`, which iOS Safari only
 * gained in 17.4; this app still runs on 16.
 */
export async function withDeadline<T>(
  call: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal | undefined,
  ms: number = AI_DEADLINE_MS,
): Promise<T> {
  // Already cancelled before we started — don't open a connection at all.
  if (callerSignal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const relay = () => controller.abort();
  callerSignal?.addEventListener('abort', relay, { once: true });

  try {
    return await call(controller.signal);
  } catch (err) {
    if (expired && isAbort(err)) {
      throw new AIError(`No response within ${Math.round(ms / 1000)}s`, 'timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', relay);
  }
}

const isAbort = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError';
