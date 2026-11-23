'use client';

import { cn } from '@karen/ui/web';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { IconMenu } from './icons';
import { ConversationSidebar } from './sidebar';

/** Two-pane chat layout; on small screens the conversation list is a toggleable drawer. */
export function ChatLayoutShell({ children }: { children: ReactNode }) {
  const params = useParams<{ id?: string }>();
  const activeId = typeof params.id === 'string' ? params.id : null;
  const [open, setOpen] = useState(false);
  return (
    <div className="relative grid h-[calc(100dvh-12.5rem)] min-h-[34rem] overflow-hidden rounded-[var(--karen-radius-xl)] border border-border bg-[var(--karen-background)] shadow-sm md:grid-cols-[17rem_1fr]">
      <button
        type="button"
        className="absolute top-2.5 left-2 z-30 inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-[var(--karen-surface-raised)] md:hidden"
        aria-label={open ? 'Hide conversations' : 'Show conversations'}
        aria-expanded={open}
        aria-controls="chat-sidebar"
        onClick={() => setOpen((o) => !o)}
      >
        <IconMenu />
      </button>
      <aside
        id="chat-sidebar"
        className={cn(
          'absolute inset-y-0 left-0 z-20 w-72 border-r border-border bg-[var(--karen-background)] p-3 pt-14 transition-transform motion-reduce:transition-none md:static md:w-auto md:translate-x-0 md:pt-3',
          // Closed drawer is also invisible so its links leave the tab order on small screens.
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full max-md:invisible',
        )}
      >
        <ConversationSidebar activeId={activeId} onNavigate={() => setOpen(false)} />
      </aside>
      <div className="min-h-0 min-w-0 pl-10 md:pl-0">{children}</div>
    </div>
  );
}
