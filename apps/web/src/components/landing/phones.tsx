import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { KarenOrb } from './karen-orb';

/**
 * Phone mock-ups of KAREN's app screens for the landing hero. Illustrative UI only: names,
 * amounts and tasks are sample content, never live data. Decorative for assistive tech —
 * each frame exposes a single descriptive label.
 */

const C = {
  blue: 'var(--karen-category-blue)',
  green: 'var(--karen-category-green)',
  violet: 'var(--karen-category-violet)',
  orange: 'var(--karen-category-orange)',
};

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="landing-phone" role="img" aria-label={label}>
      <div className="landing-phone-screen flex flex-col px-4 pt-3 pb-3" aria-hidden="true">
        <div className="relative flex items-center justify-between px-2 text-[11px] font-semibold">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-[2px] bg-white/80" />
            <span className="h-2 w-4 rounded-[3px] border border-white/70" />
          </span>
        </div>
        {children}
        <span className="relative mx-auto mt-2 block h-1 w-24 shrink-0 rounded-full bg-white/70" />
      </div>
    </div>
  );
}

function Chip({ icon, color, size = 'size-8' }: { icon: IconName; color: string; size?: string }) {
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-xl text-white`}
      style={{ background: color, boxShadow: `0 6px 14px -6px ${color}` }}
    >
      <Icon name={icon} className="size-4" />
    </span>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10">
      <span
        className="block h-full rounded-full"
        style={{ width: `${value}%`, background: color }}
      />
    </span>
  );
}

/** Home dashboard: greeting, today's plan, goal/refund cards, upcoming list, floating nav. */
export function HomePhone() {
  const segments: { icon: IconName; color: string; grow: number }[] = [
    { icon: 'chat', color: C.violet, grow: 1 },
    { icon: 'check', color: C.green, grow: 1 },
    { icon: 'receipt', color: C.orange, grow: 2 },
    { icon: 'bell', color: C.blue, grow: 2.4 },
  ];
  const rows: { icon: IconName; color: string; title: string; sub: string; meta: string }[] = [
    {
      icon: 'bell',
      color: C.green,
      title: 'Pay electricity bill',
      sub: 'Reminder',
      meta: '6:00 PM',
    },
    { icon: 'target', color: C.violet, title: "Mom's birthday gift", sub: 'Goal', meta: '12 Jun' },
    {
      icon: 'receipt',
      color: C.orange,
      title: 'Refund follow-up',
      sub: 'Awaiting airline',
      meta: '₹8,500',
    },
  ];
  return (
    <Frame label="Preview of the KAREN home dashboard">
      <div className="relative mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-[#a9c8f5] to-[#3a6fe0] text-sm font-semibold ring-2 ring-white/20">
            P
          </span>
          <span>
            <span className="block text-[13px] font-semibold">Priya Sharma</span>
            <span className="block text-[10.5px] text-white/55">Good evening</span>
          </span>
        </div>
        <span className="landing-phone-glass grid size-9 place-items-center rounded-full">
          <Icon name="chat" className="size-4" />
        </span>
      </div>

      <p className="relative mt-4 text-[21px] leading-tight font-medium">
        <span className="text-[#7faef2]">Your day,</span> organised and followed through.
      </p>

      <div className="landing-phone-glass relative mt-3 rounded-2xl p-2.5">
        <div className="flex justify-between text-[10px]">
          <span className="text-white/70">
            Done: <span className="text-[#7faef2]">3 tasks</span>
          </span>
          <span className="text-white/70">Planned today: 5</span>
        </div>
        <div className="mt-2 flex gap-1">
          {segments.map((s) => (
            <span
              key={s.icon}
              className="grid h-6 place-items-center rounded-md text-white"
              style={{ background: s.color, flexGrow: s.grow, flexBasis: 0 }}
            >
              <Icon name={s.icon} className="size-3" />
            </span>
          ))}
        </div>
      </div>

      <div className="relative mt-2.5 grid grid-cols-2 gap-2">
        <div className="landing-phone-glass rounded-2xl p-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium">
            <Icon name="target" className="size-3.5" /> Savings goal
          </span>
          <p className="mt-1 text-[9.5px] leading-snug text-white/60">₹10,000 a month</p>
          <div className="mt-1.5 flex justify-between text-[9.5px] font-semibold">
            <span className="text-[#7faef2]">₹6,200</span>
            <span>₹10k</span>
          </div>
          <Bar value={62} color={C.blue} />
        </div>
        <div className="landing-phone-glass rounded-2xl p-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium">
            <Icon name="receipt" className="size-3.5" /> Refund case
          </span>
          <p className="mt-1 text-[9.5px] leading-snug text-white/60">Follow-up day 4 of 7</p>
          <div className="mt-1.5 flex justify-between text-[9.5px] font-semibold">
            <span className="text-[#f2b98a]">Day 4</span>
            <span>Day 7</span>
          </div>
          <Bar value={57} color={C.orange} />
        </div>
      </div>

      <div className="relative mt-3 flex items-center justify-between text-[12px] font-semibold">
        <span>Upcoming</span>
        <span className="text-[10px] font-medium text-[#7faef2]">See all</span>
      </div>
      <div className="landing-phone-glass relative mt-1.5 space-y-1.5 rounded-2xl p-1.5">
        {rows.map((r) => (
          <div key={r.title} className="flex items-center gap-2 rounded-xl bg-white/5 p-1.5">
            <Chip icon={r.icon} color={r.color} size="size-7" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium">{r.title}</span>
              <span className="block text-[9.5px] text-white/50">{r.sub}</span>
            </span>
            <span className="text-[10.5px] font-semibold">{r.meta}</span>
          </div>
        ))}
      </div>

      <div className="relative mt-auto flex justify-center pt-2">
        <div className="flex gap-1.5 rounded-full border border-white/10 bg-white/10 p-1.5 backdrop-blur-md">
          {(['memory', 'list', 'chat', 'users'] as const).map((icon, i) => (
            <span
              key={icon}
              className={`grid size-9 place-items-center rounded-full ${
                i === 0 ? 'bg-[#3a6fe0] shadow-[0_6px_16px_-4px_rgb(37_99_235/0.9)]' : 'bg-white/5'
              }`}
            >
              <Icon name={icon} className="size-4" />
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/** "Ask KAREN" voice screen with the glowing orb and quick actions. */
export function AskPhone() {
  const quick: { icon: IconName; label: string; color: string }[] = [
    { icon: 'memory', label: 'Remember a preference', color: C.green },
    { icon: 'bell', label: 'Set a reminder', color: C.violet },
    { icon: 'receipt', label: 'Follow up a refund', color: C.orange },
  ];
  return (
    <Frame label="Preview of the Ask KAREN voice screen">
      <div className="relative mt-4 flex items-center justify-between">
        <span className="landing-phone-glass grid size-9 place-items-center rounded-full">
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-sm font-medium">Ask KAREN</span>
        <span className="landing-phone-glass grid size-9 place-items-center rounded-full text-base leading-none">
          ⋮
        </span>
      </div>
      <div className="relative mt-12 flex justify-center">
        <KarenOrb size={140} />
      </div>
      <p className="relative mt-12 text-center text-[19px] leading-snug font-medium">
        <span className="text-[#7faef2]">Hi Priya,</span> what should I take care of today?
      </p>
      <div className="relative mt-auto grid grid-cols-3 gap-2">
        {quick.map((a) => (
          <div key={a.label} className="landing-phone-glass rounded-2xl p-2.5">
            <span
              className="grid size-8 place-items-center rounded-full text-white"
              style={{ background: a.color, boxShadow: `0 6px 16px -6px ${a.color}` }}
            >
              <Icon name={a.icon} className="size-4" />
            </span>
            <p className="mt-2 text-[10.5px] leading-tight text-white/85">{a.label}</p>
          </div>
        ))}
      </div>
      <div className="landing-phone-glass relative mt-3 flex items-center justify-between rounded-full py-1.5 pr-1.5 pl-4">
        <span className="text-[11px] text-white/60">Type, talk or share a photo</span>
        <span className="flex items-center gap-2 rounded-full bg-[#3a6fe0] px-3 py-2">
          <Icon name="mic" className="size-3.5" />
          <Icon name="sparkle" className="size-3.5" />
        </span>
      </div>
    </Frame>
  );
}
