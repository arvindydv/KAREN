import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { commands, features, pillars, steps, trustPoints, type Availability } from './content';
import { TaskDemo } from './hero';
import { Icon } from './icons';
import { Spotlight } from './spotlight';

/** Per-element CSS custom properties (stagger index, delays) for the CSS-only animations. */
export const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** Category colours cycle across cards (blue, green, violet, orange), like app category chips. */
const CHIPS = ['blue', 'green', 'violet', 'orange'] as const;
const chip = (i: number) => `var(--karen-category-${CHIPS[i % CHIPS.length]})`;

function SectionHeading({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="landing-reveal mx-auto max-w-2xl text-center">
      <p className="landing-eyebrow">{eyebrow}</p>
      <h2 id={id} className="mt-5 text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
        {title}
      </h2>
      {children ? <p className="mt-4 text-lg text-muted">{children}</p> : null}
    </div>
  );
}

export function Pillars() {
  return (
    <section aria-labelledby="pillars-title" className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <SectionHeading id="pillars-title" eyebrow="Five pillars" title="More than a chatbot">
        KAREN is the personal intelligence and responsibility layer across your digital life.
      </SectionHeading>
      <Spotlight className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {pillars.map((p, i) => (
          <li
            key={p.title}
            className="landing-card landing-reveal group rounded-3xl p-6"
            style={vars({ '--i': i, '--chip': chip(i) })}
          >
            <span className="landing-icon-chip grid size-11 place-items-center rounded-2xl">
              <Icon name={p.icon} className="size-5" />
            </span>
            <h3 className="mt-5 font-semibold">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
          </li>
        ))}
      </Spotlight>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="landing-band relative scroll-mt-20 overflow-hidden py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="From intent to verified outcome"
        >
          You give the goal. KAREN owns the follow-through — and asks before every step that
          matters.
        </SectionHeading>
        <ol className="relative mt-16 grid gap-8 md:grid-cols-5 md:gap-4">
          <span className="landing-flow-line" aria-hidden="true" />
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="landing-reveal relative text-center"
              style={vars({ '--i': i, '--chip': chip(i) })}
            >
              <span className="landing-step-num mx-auto grid size-14 place-items-center rounded-2xl text-lg font-semibold">
                {i + 1}
              </span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mx-auto mt-2 max-w-[16rem] text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="landing-reveal mt-16 flex justify-center">
          <TaskDemo />
        </div>
      </div>
    </section>
  );
}

const availabilityTone: Record<Availability, string> = {
  'First release': 'landing-tag-now',
  Next: 'landing-tag-next',
  Later: 'landing-tag-later',
};

export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 sm:py-28"
    >
      <SectionHeading
        id="features-title"
        eyebrow="Everything KAREN does"
        title="One agent for the busy parts of life"
      >
        Starting with the essentials and growing vertical by vertical — each one only when a
        legitimate partner integration makes it reliable.
      </SectionHeading>
      <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs" aria-label="Legend">
        {(Object.keys(availabilityTone) as Availability[]).map((a) => (
          <span key={a} className={`${availabilityTone[a]} rounded-full px-3 py-1 font-medium`}>
            {a}
          </span>
        ))}
      </div>
      <Spotlight className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => (
          <li
            key={f.title}
            className="landing-card landing-reveal group flex flex-col rounded-3xl p-6"
            style={vars({ '--i': i % 3, '--chip': chip(i) })}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="landing-icon-chip grid size-11 place-items-center rounded-2xl">
                <Icon name={f.icon} className="size-5" />
              </span>
              <span
                className={`${availabilityTone[f.availability]} rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap`}
              >
                {f.availability}
              </span>
            </div>
            <h3 className="mt-5 font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
          </li>
        ))}
      </Spotlight>
    </section>
  );
}

function CommandRow({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  // The list is rendered twice so the marquee can loop seamlessly; the copy is hidden from AT.
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 gap-4 pr-4" aria-hidden={hidden || undefined}>
      {items.map((c) => (
        <li
          key={c}
          className="landing-glass flex items-center gap-2 rounded-full px-5 py-3 text-sm whitespace-nowrap"
        >
          <span className="landing-gradient-text font-semibold">KAREN,</span>
          <span className="text-muted">{c}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="landing-marquee-mask flex overflow-hidden">
      <div className={`landing-marquee flex ${reverse ? 'landing-marquee-reverse' : ''}`}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

export function Commands() {
  const half = Math.ceil(commands.length / 2);
  return (
    <section aria-labelledby="commands-title" className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading id="commands-title" eyebrow="Just ask" title="Talk to it like a person">
          Outcome-first requests, in your own words.
        </SectionHeading>
      </div>
      <div className="mt-12 space-y-4">
        <CommandRow items={commands.slice(0, half)} />
        <CommandRow items={commands.slice(half)} reverse />
      </div>
    </section>
  );
}

export function Trust() {
  return (
    <section
      id="trust"
      aria-labelledby="trust-title"
      className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 sm:py-28"
    >
      <div className="landing-trust relative overflow-hidden rounded-[2rem] p-8 sm:p-14">
        <div className="landing-grain" aria-hidden="true" />
        <div className="landing-aurora landing-aurora-soft" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
          <div className="landing-reveal">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#a9c8f5] uppercase">
              Trust by design
            </p>
            <h2
              id="trust-title"
              className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-5xl"
            >
              Powerful because it is careful.
            </h2>
            <p className="mt-4 text-lg text-white/80">
              The AI proposes. Your approval — checked by our backend, not the model — decides.
              Every action is logged, and attempted is never reported as completed.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {trustPoints.map((t, i) => (
              <li
                key={t.title}
                className="landing-reveal rounded-2xl border border-white/15 bg-white/10 p-5 text-white backdrop-blur-md"
                style={vars({ '--i': i })}
              >
                <Icon name={t.icon} className="size-6" />
                <h3 className="mt-3 font-semibold">{t.title}</h3>
                <p className="mt-1.5 text-sm text-white/80">{t.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="mx-auto max-w-4xl px-6 pt-4 pb-24 text-center">
      <div className="landing-reveal">
        <h2 id="cta-title" className="text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
          Tell KAREN what matters.
          <br />
          <span className="landing-gradient-text">It takes it from there.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted">
          KAREN is in active development. The first release focuses on chat, memory, goals,
          reminders and tasks with verified completion.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/app" className="landing-btn-primary">
            Open KAREN
            <Icon name="arrow" className="size-4" />
          </Link>
          <a href="#features" className="landing-btn-ghost">
            Explore features
          </a>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div className="landing-divider" aria-hidden="true" />
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-muted sm:flex-row">
        <p>
          <span className="landing-gradient-text font-semibold">KAREN</span> · Personal AI life
          agent · Made in India
        </p>
        <p>Pre-release. Features are subject to partner availability.</p>
      </div>
    </footer>
  );
}
