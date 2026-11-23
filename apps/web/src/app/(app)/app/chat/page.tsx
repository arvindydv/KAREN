import { ChatView } from '@/components/chat/chat-view';
import { loadChatGate } from '@/lib/chat/gate';

export const metadata = { title: 'Chat' };

export default async function NewChatPage() {
  return <ChatView key="new" conversationId={null} gate={await loadChatGate()} />;
}
