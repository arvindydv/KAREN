import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Icon } from './icons';
import { AskPhone, HomePhone } from './phones';

const css = (v: Record<string, string | number>) => v as CSSProperties;

const demoSteps = [
  { label: 'Understood your request', detail: 'Bengaluru · Fri evening · cabin bag' },
  { label: 'Compared 3 options', detail: 'Incl. baggage & cancellation costs' },
  { label: 'Approved by you', detail: '₹5,480 · 1 adult · expires in 15 min' },
  { label: 'Booking submitted', detail: 'Waiting for the airline' },
  { label: 'Verified by provider', detail: 'Ticket issued · evidence saved' },
];

/** Illustrative only: an animated walk through KAREN's task lifecycle (no real booking). */
export function TaskDemo() {
  return (
    <div className="landing-glass landing-beam relative w-[19rem] rounded-3xl p-4">
      <p className="text-[11px] font-medium text-muted">Task · Flight to Bengaluru</p>
      <ol className="mt-3 space-y-2.5" aria-label="Task progress (illustrative example)">
        {demoSteps.map((step, i) => (
          <li
            key={step.label}
            className="landing-demo-step flex items-start gap-2.5"
            style={css({ '--i': i })}
          >
            <span className="landing-demo-dot mt-0.5 grid size-5 shrink-0 place-items-center rounded-full">
              <svg viewBox="0 0 24 24" className="size-3" aria-hidden="true">
                <path
                  d="m6 12.5 4 4L18 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>
              <span className="block text-[13px] leading-tight font-medium">{step.label}</span>
              <span className="block text-[11px] text-muted">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted">
        Illustrative example of a task timeline · not a live booking
      </p>
    </div>
  );
}

/** Decorative light ribbons (cool blue→violet and warm lime→green), slowly swaying. */
function Ribbons({ className }: { className: string }) {
  return (
    <svg
      className={`landing-ribbons ${className}`}
      viewBox="0 0 800 800"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="ribbon-cool" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2563eb" stopOpacity="0" />
          <stop offset="0.35" stopColor="#2563eb" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="ribbon-warm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c6f432" />
          <stop offset="0.6" stopColor="#22c55e" />
          <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
        </linearGradient>
        <filter id="ribbon-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      <g className="ribbon-a">
        <path
          d="M-60 760 C 140 430, 380 210, 860 120 L 860 300 C 480 330, 260 520, 120 860 Z"
          fill="url(#ribbon-cool)"
          filter="url(#ribbon-soft)"
          opacity="0.7"
        />
        <path
          d="M-60 760 C 140 430, 380 210, 860 120 L 860 230 C 460 280, 240 480, 60 820 Z"
          fill="url(#ribbon-cool)"
        />
      </g>
      <g className="ribbon-b">
        <path
          d="M300 -40 C 420 150, 600 250, 860 240 L 860 300 C 560 320, 370 190, 240 -40 Z"
          fill="url(#ribbon-warm)"
          filter="url(#ribbon-soft)"
          opacity="0.8"
        />
        <path
          d="M300 -40 C 420 150, 600 250, 860 240 L 860 268 C 570 290, 380 170, 262 -40 Z"
          fill="url(#ribbon-warm)"
        />
      </g>
    </svg>
  );
}

// Rendered word-by-word for the staggered reveal; the last three words carry the highlight.
const headline = ['Your', 'life.', 'Understood.', 'Taken', 'care', 'of.'];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="landing-hero relative isolate overflow-hidden">
      <Ribbons className="-top-24 right-[-18rem] h-[56rem] w-[56rem] sm:right-[-10rem] lg:right-[-6rem]" />
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-14 px-6 pt-32 pb-24 sm:pt-36 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-32">
        <div className="space-y-7">
          <p className="landing-rise landing-eyebrow">Personal AI life agent · Pre-release</p>
          <h1
            id="hero-title"
            className="text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.035em] sm:text-7xl"
          >
            {/* Animated words are visual only; assistive tech reads the full sentence once. */}
            <span className="sr-only">{headline.join(' ')}</span>
            <span aria-hidden="true">
              {headline.map((word, w) => (
                <span key={word}>
                  <span
                    className={`landing-word ${w >= 3 ? 'landing-gradient-text' : ''}`}
                    style={css({ '--w': w })}
                  >
                    {word}
                  </span>{' '}
                </span>
              ))}
            </span>
          </h1>
          <p
            className="landing-rise max-w-[30rem] text-lg text-muted sm:text-xl"
            style={css({ '--d': '420ms' })}
          >
            KAREN is your personal AI life agent. Tell it what matters — it remembers, prepares,
            acts <strong className="font-semibold text-foreground">with your permission</strong>,
            and follows through until it is verifiably done.
          </p>
          <div className="landing-rise flex flex-wrap gap-3" style={css({ '--d': '520ms' })}>
            <Link href="/app" className="landing-btn-primary min-w-44">
              Get started
              <Icon name="arrow" className="size-4" />
            </Link>
            <a href="#how-it-works" className="landing-btn-ghost">
              See how it works
            </a>
          </div>
          <ul
            className="landing-rise flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted"
            style={css({ '--d': '620ms' })}
          >
            {[
              'Asks before it acts',
              'Never needs your OTP or PIN',
              'Hindi · Hinglish · English',
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Icon name="check" className="size-4 text-[var(--karen-success)]" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div
          className="landing-rise relative flex justify-center lg:justify-end"
          style={css({ '--d': '300ms' })}
        >
          {/* Two app screens side by side, like a product shot: Home in front, Ask KAREN behind. */}
          <div className="flex items-start lg:origin-right lg:scale-[0.9] xl:scale-95">
            <div className="landing-float relative z-10 lg:mt-16">
              <HomePhone />
            </div>
            <div className="landing-float-slow relative -ml-14 hidden lg:block">
              <AskPhone />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
