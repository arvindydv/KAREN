import { handleProxy } from '@/lib/bff/proxy-handler';

/** Allowlisted browser → API proxy (see lib/bff/proxy-handler.ts). Never cached. */
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ path: string[] }>;
}

const handle = async (request: Request, { params }: Ctx): Promise<Response> =>
  handleProxy(request, (await params).path);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
