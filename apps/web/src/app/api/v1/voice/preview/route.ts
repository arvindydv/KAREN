import { handleVoicePreviewProxy } from '@/lib/bff/speech-proxy';

/** Streaming audio pass-through for a voice preview (see lib/bff/speech-proxy.ts). */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleVoicePreviewProxy(request);
}
