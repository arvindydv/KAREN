import type { ReactNode } from 'react';
import { ChatLayoutShell } from '@/components/chat/chat-layout-shell';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <ChatLayoutShell>{children}</ChatLayoutShell>;
}
