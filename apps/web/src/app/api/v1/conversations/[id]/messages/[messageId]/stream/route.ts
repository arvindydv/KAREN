import { handleStreamProxy } from '@/lib/bff/stream-proxy';

/** SSE pass-through for an assistant message (see lib/bff/stream-proxy.ts). Never cached. */
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string; messageId: string }>;
}

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const { id, messageId } = await params;
  return handleStreamProxy(request, id, messageId);
}
