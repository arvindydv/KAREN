'use client';

import { Button, Card, cn } from '@karen/ui/web';
import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

/** A text field's value from FormData (files and missing fields → fallback). */
export function formString(form: FormData, name: string, fallback = ''): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : fallback;
}

export const inputClass =
  'block w-full min-h-11 rounded-[var(--karen-radius-md)] border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--karen-focus-ring)] disabled:opacity-60 aria-[invalid=true]:border-[var(--karen-danger)]';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
}

/** Labelled input with hint and error wired through aria-describedby. */
export function TextField({ label, hint, error, id, className, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        className={cn(inputClass, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-[var(--karen-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Password input with a show/hide toggle. Never pre-filled; no composition rules (NIST). */
export function PasswordField(props: FieldProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1">
      <TextField
        {...props}
        type={shown ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="none"
      />
      <button
        type="button"
        className="text-xs text-muted underline underline-offset-2"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
      >
        {shown ? 'Hide password' : 'Show password'}
      </button>
    </div>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly { value: string; label: string }[];
  hint?: ReactNode;
}

export function SelectField({ label, options, hint, id, className, ...props }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="space-y-1.5">
      <label htmlFor={selectId} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={selectId}
        className={cn(inputClass, className)}
        aria-describedby={hint ? `${selectId}-hint` : undefined}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={`${selectId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Accessible switch (a checkbox with role="switch"). */
export function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
  badge,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  badge?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="space-y-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {label}
          {badge}
        </label>
        {description ? (
          <p id={`${id}-desc`} className="text-xs text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="mt-1 size-5 shrink-0 accent-[var(--karen-accent)] disabled:opacity-50"
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? `${id}-desc` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

export function FormAlert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'success' | 'info';
  children: ReactNode;
}) {
  const toneClass = {
    danger: 'border-[var(--karen-danger)] text-[var(--karen-danger)]',
    success: 'border-[var(--karen-success)] text-[var(--karen-success)]',
    info: 'border-border text-muted',
  }[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      className={cn('rounded-[var(--karen-radius-md)] border px-3 py-2 text-sm', toneClass)}
    >
      {children}
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingLabel,
  variant,
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      variant={variant ?? 'primary'}
      className="w-full sm:w-auto"
    >
      {pending ? (pendingLabel ?? 'Please wait…') : children}
    </Button>
  );
}

/** Centered card shell for public auth pages (clears the floating header). */
export function AuthShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-28 pb-16 sm:px-6">
      <Card className="mx-auto max-w-md space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {intro ? <div className="text-sm text-muted">{intro}</div> : null}
        </div>
        {children}
      </Card>
    </div>
  );
}
