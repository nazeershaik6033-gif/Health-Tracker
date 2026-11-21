import { useEffect, useRef, useState } from 'react';
import { MOUNT_SETTLE_MS, isBooting } from './motion';

/**
 * Whether a value change should animate right now.
 *
 * False while a screen is still arriving — its first render shows placeholder
 * zeroes and its live query lands a few frames later — unless this is the
 * session's first screen, where the fill-in is the intended welcome. True for
 * everything after, so logging a meal still eases the bars to their new
 * length.
 *
 * Read at render time, which every value change triggers anyway, so this
 * costs no extra render of its own.
 */
export function useAnimateChanges(): boolean {
  const [welcome] = useState(isBooting);
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);
  return welcome || (mountedAt.current > 0 && performance.now() - mountedAt.current >= MOUNT_SETTLE_MS);
}
