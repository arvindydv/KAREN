import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from './cn.js';

export const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--karen-radius-md)] px-4 text-sm font-medium transition-[transform,background-color,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--karen-focus-ring)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--karen-accent)] text-[var(--karen-accent-text)] hover:opacity-90',
        secondary:
          'border border-[var(--karen-border)] bg-[var(--karen-surface)] text-[var(--karen-text-primary)] hover:bg-[var(--karen-background)]',
        ghost: 'text-[var(--karen-text-primary)] hover:bg-[var(--karen-surface)]',
        danger: 'bg-[var(--karen-danger)] text-white hover:opacity-90',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next.js Link) with button styling. */
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
}
