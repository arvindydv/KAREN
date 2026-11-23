'use client';

import { useEffect, useId, useRef, type CSSProperties } from 'react';

/**
 * KAREN's AI orb: a glowing cyan plasma sphere with a white "voice assistant" mic glyph.
 * Layered CSS gradients (styles in app/landing.css → `.karen-orb*`) are warped by an animated
 * SVG turbulence filter so the wisps flow and morph like live plasma. SMIL animation is not
 * covered by the CSS reduced-motion rule, so it is paused explicitly when the user asks.
 * Decorative (aria-hidden).
 */
export function KarenOrb({ size = 136, className = '' }: { size?: number; className?: string }) {
  const filterId = `karen-orb-warp-${useId().replace(/:/g, '')}`;
  const defs = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Guarded: non-browser DOMs (e.g. jsdom in tests) lack matchMedia / SMIL controls.
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const svg = defs.current;
      if (!svg || typeof svg.pauseAnimations !== 'function') return;
      if (media.matches) svg.pauseAnimations();
      else svg.unpauseAnimations();
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  return (
    <div
      className={`karen-orb ${className}`}
      style={{ '--orb-size': `${size}px`, '--orb-warp': `url(#${filterId})` } as CSSProperties}
      aria-hidden="true"
    >
      <svg ref={defs} className="karen-orb-defs" width="0" height="0" focusable="false">
        <filter id={filterId} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="4">
            <animate
              attributeName="baseFrequency"
              values="0.016;0.024;0.019;0.016"
              dur="9s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="34" />
        </filter>
      </svg>
      <span className="karen-orb-halo" />
      {/* Round body clips the warped plasma so the silhouette stays a perfect sphere. */}
      <span className="karen-orb-body">
        <span className="karen-orb-core" />
        <span className="karen-orb-swirl karen-orb-rings-dark" />
        <span className="karen-orb-swirl karen-orb-rings-light" />
        <span className="karen-orb-swirl karen-orb-glint" />
        <span className="karen-orb-rim" />
        <span className="karen-orb-shine" />
      </span>
      <MicGlyph />
    </div>
  );
}

/** White mic with a small "eye" dot and two twinkling sparkles (voice AI assistant). */
function MicGlyph() {
  return (
    <svg className="karen-orb-icon" viewBox="0 0 24 24" fill="none" focusable="false">
      <rect x="8" y="3.5" width="8" height="11.5" rx="4" fill="#fff" />
      <circle cx="13.6" cy="7.6" r="1.15" fill="#22397a" />
      <path
        d="M5.8 11.3a6.2 6.2 0 0 0 12.4 0"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M12 17.6v2.6M9.2 20.4h5.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path
        className="karen-orb-sparkle"
        d="M19.6 1.6c.2 1.3.7 1.8 2 2-1.3.2-1.8.7-2 2-.2-1.3-.7-1.8-2-2 1.3-.2 1.8-.7 2-2Z"
        fill="#fff"
      />
      <path
        className="karen-orb-sparkle karen-orb-sparkle-2"
        d="M21.6 6.4c.1.7.4 1 1.1 1.1-.7.1-1 .4-1.1 1.1-.1-.7-.4-1-1.1-1.1.7-.1 1-.4 1.1-1.1Z"
        fill="#fff"
      />
    </svg>
  );
}
