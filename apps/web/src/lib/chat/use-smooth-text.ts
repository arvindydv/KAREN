'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { nextRevealLength, safeSliceEnd } from './smooth-text';

/**
 * Returns the part of `text` to display. While `animate` is true the visible text eases toward
 * the full text frame by frame (and keeps easing after the stream ends until caught up);
 * otherwise (history, reduced motion) the full text is returned at once.
 */
export function useSmoothText(text: string, animate: boolean): string {
  const [shown, setShown] = useState(() => (animate ? 0 : text.length));
  const shownRef = useRef(shown);
  const target = text.length;

  useEffect(() => {
    if (!animate || shownRef.current >= target) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(100, now - last);
      last = now;
      const next = nextRevealLength(Math.min(shownRef.current, target), target, elapsed);
      shownRef.current = next;
      setShown(next);
      if (next < target) raf = requestAnimationFrame(tick); // idle once caught up
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, target]);

  if (!animate) return text;
  return text.slice(0, safeSliceEnd(text, Math.min(shown, target)));
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True when the OS asks for reduced motion (live). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** Browser connectivity (live). Server render assumes online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('online', onChange);
      window.addEventListener('offline', onChange);
      return () => {
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
