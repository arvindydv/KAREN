import { notFound } from 'next/navigation';
import { ChatView } from '@/components/chat/chat-view';
import { loadChatGate } from '@/lib/chat/gate';

export const metadata = { title: 'Chat' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <ChatView key={id} conversationId={id} gate={await loadChatGate()} />;
}
