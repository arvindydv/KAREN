'use client';

import type { PointerEvent, ReactNode } from 'react';

/**
 * Cursor-following glow for `.landing-card` children. One delegated pointer handler sets
 * --mx/--my on the hovered card; the glow itself is pure CSS. Without JS, or with
 * reduced motion, cards simply keep their static hover styles.
 */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    const card = (event.target as HTMLElement).closest<HTMLElement>('.landing-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    card.style.setProperty('--my', `${event.clientY - rect.top}px`);
  };
  return (
    <ul className={className} onPointerMove={onPointerMove}>
      {children}
    </ul>
  );
}
