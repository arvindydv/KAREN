import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--karen-radius-lg)] border border-[var(--karen-border)] bg-[var(--karen-surface)] p-6 text-[var(--karen-text-primary)]',
        className,
      )}
      {...props}
    />
  );
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

const toneClass: Record<StatusTone, string> = {
  neutral: 'border-[var(--karen-border)] text-[var(--karen-text-secondary)]',
  success: 'border-[var(--karen-success)] text-[var(--karen-success)]',
  warning: 'border-[var(--karen-warning)] text-[var(--karen-warning)]',
  danger: 'border-[var(--karen-danger)] text-[var(--karen-danger)]',
};

/** Status badge — always carries a text label, never colour alone (spec §26.3). */
export function StatusBadge({ tone = 'neutral', label }: { tone?: StatusTone; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        toneClass[tone],
      )}
    >
      {label}
    </span>
  );
}
