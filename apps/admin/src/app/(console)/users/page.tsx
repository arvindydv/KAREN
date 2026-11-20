import { Card } from '@karen/ui/web';
import { requireStaffSession } from '@/lib/staff-session';
import { UserStatusLookup } from './user-status-lookup';

export const metadata = { title: 'User status lookup' };

export default async function UserStatusPage() {
  await requireStaffSession();
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">User account status</h1>
      <p className="text-sm text-muted">
        Shows a consumer account&apos;s <strong>status only</strong> — never profile, memories or
        messages. Requires <code>users:read_status</code> and an access reason; every lookup is
        audited as a sensitive read.
      </p>
      <UserStatusLookup />
    </Card>
  );
}
