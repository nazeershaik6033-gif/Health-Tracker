import { useEffect, useState } from 'react';
import { sampleFrameRate } from '@/lib/motion';

/**
 * A frame-rate readout, off by default and turned on in Settings.
 *
 * The point of it is diagnosis on a real device: a transition that stutters
 * on a phone almost never stutters in a desktop browser, and without a number
 * on screen there is nothing to tell a genuinely dropped frame from an
 * animation curve that just looks slow.
 *
 * The sampler itself schedules one rAF per frame and does no layout work, so
 * having it on does not meaningfully change what it is measuring.
 */
export function FpsMeter() {
  const [fps, setFps] = useState<number | null>(null);
  // The worst window seen since mount — a stutter is over before you can look
  // at the readout, so the instantaneous number alone would never show it.
  const [low, setLow] = useState<number | null>(null);

  useEffect(() => {
    return sampleFrameRate((sample) => {
      setFps(sample);
      setLow((prev) => (prev === null ? sample : Math.min(prev, sample)));
    });
  }, []);

  if (fps === null) return null;

  // Thresholds are relative to what the display can actually do: a 60Hz panel
  // is at its ceiling at 60, so a fixed "120 is good" bar would paint every
  // 60Hz device red forever.
  const tone = fps >= 55 ? '#22c55e' : fps >= 40 ? '#f0b429' : '#ef4444';

  return (
    <div
      aria-hidden="true"
      className="tabular pointer-events-none fixed left-2 z-[60] rounded-md px-1.5 py-1 text-[10px] leading-none font-bold"
      style={{
        // Above the bottom nav, which the app pads to 5.5rem + safe area.
        bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
        background: 'rgb(0 0 0 / 0.68)',
        color: tone,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {fps} fps
      <span style={{ opacity: 0.6 }}> · min {low}</span>
    </div>
  );
}
