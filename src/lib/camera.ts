import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable' | 'error';

interface Options {
  /** Barcode scanning wants a higher resolution than meal photos. */
  ideal?: { width: number; height: number };
  autoStart?: boolean;
  /**
   * Zoom to apply once the stream is live, where the camera supports it.
   *
   * For the barcode scanner. Recent iPhone Pro main cameras cannot focus
   * closer than about 20 cm, so a pack held at the natural "scan it" distance
   * is blurred past what any decoder can read — and the user's instinct, to
   * move closer, makes it worse. A 2x zoom fills the guide box from twice as
   * far away, which is inside the focus range. Native scanner apps do the
   * same thing.
   */
  zoom?: number;
}

type ExtendedCaps = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
};

/**
 * Rear-camera access with the failure modes browsers actually produce:
 * permission denied, no camera present, camera busy in another app, and
 * insecure context (getUserMedia is unavailable outside HTTPS/localhost).
 */
export function useCamera({ ideal, autoStart = true, zoom: preferredZoom }: Options = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  /** Supported zoom range, or null when the camera cannot zoom. */
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [zoom, setZoomState] = useState(1);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
    setTorchOn(false);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;

    if (!window.isSecureContext) {
      setStatus('unavailable');
      setError('The camera needs a secure (HTTPS) connection.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setError('This browser does not support camera access.');
      return;
    }

    setStatus('starting');
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: ideal?.width ?? 1280 },
          height: { ideal: ideal?.height ?? 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {
          /* autoplay can be blocked; the poster frame still shows */
        });
      }

      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as ExtendedCaps | undefined;
      setTorchAvailable(Boolean(caps?.torch));

      // Continuous autofocus where the browser exposes the choice; some
      // Android cameras otherwise lock focus at whatever was in view first.
      if (caps?.focusMode?.includes('continuous')) {
        await track
          .applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as unknown as MediaTrackConstraints)
          .catch(() => {});
      }

      const range = caps?.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
      setZoomRange(range ? { min: range.min, max: range.max } : null);
      if (range && preferredZoom) {
        const target = Math.min(range.max, Math.max(range.min, preferredZoom));
        try {
          await track.applyConstraints({ advanced: [{ zoom: target }] } as unknown as MediaTrackConstraints);
          setZoomState(target);
        } catch {
          setZoomState(1);
        }
      } else {
        setZoomState(1);
      }
      setStatus('live');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied');
        setError('Camera permission was denied. Allow it in your browser settings and try again.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setStatus('unavailable');
        setError('No camera was found on this device.');
      } else if (name === 'NotReadableError') {
        setStatus('error');
        setError('The camera is already in use by another app.');
      } else {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Could not start the camera.');
      }
    }
  }, [ideal?.width, ideal?.height, preferredZoom]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      // `torch` is a real constraint on Android Chrome but isn't in the DOM
      // typings, so it has to go through unknown.
      await track.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  const setZoom = useCallback(
    async (value: number) => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || !zoomRange) return;
      const target = Math.min(zoomRange.max, Math.max(zoomRange.min, value));
      try {
        await track.applyConstraints({ advanced: [{ zoom: target }] } as unknown as MediaTrackConstraints);
        setZoomState(target);
      } catch {
        /* the camera refused; leave the zoom where it was */
      }
    },
    [zoomRange],
  );

  useEffect(() => {
    if (autoStart) void start();
    return stop;
    // start/stop are stable; re-running on every render would thrash the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return {
    videoRef,
    status,
    error,
    start,
    stop,
    torchOn,
    torchAvailable,
    toggleTorch,
    zoom,
    zoomRange,
    setZoom,
  };
}
