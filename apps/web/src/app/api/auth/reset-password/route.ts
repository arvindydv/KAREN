import { handleResetPassword } from '@/lib/bff/auth-handlers';

export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return handleResetPassword(request);
}
