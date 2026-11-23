import { handleVoiceEventsProxy } from '@/lib/bff/stream-proxy';

/** SSE pass-through for a live voice session (see lib/bff/stream-proxy.ts). Never cached. */
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ sid: string }>;
}

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const { sid } = await params;
  return handleVoiceEventsProxy(request, sid);
}
