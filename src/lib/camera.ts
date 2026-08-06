import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable' | 'error';

interface Options {
  /** Barcode scanning wants a higher resolution than meal photos. */
  ideal?: { width: number; height: number };
  autoStart?: boolean;
}

/**
 * Rear-camera access with the failure modes browsers actually produce:
 * permission denied, no camera present, camera busy in another app, and
 * insecure context (getUserMedia is unavailable outside HTTPS/localhost).
 */
export function useCamera({ ideal, autoStart = true }: Options = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

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
      const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorchAvailable(Boolean(caps?.torch));
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
  }, [ideal?.width, ideal?.height]);

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

  useEffect(() => {
    if (autoStart) void start();
    return stop;
    // start/stop are stable; re-running on every render would thrash the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return { videoRef, status, error, start, stop, torchOn, torchAvailable, toggleTorch };
}
