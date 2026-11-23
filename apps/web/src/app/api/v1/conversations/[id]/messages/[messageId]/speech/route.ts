import { handleSpeechProxy } from '@/lib/bff/speech-proxy';

/** Streaming audio pass-through for a spoken reply (see lib/bff/speech-proxy.ts). */
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string; messageId: string }>;
}

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const { id, messageId } = await params;
  return handleSpeechProxy(request, id, messageId);
}
