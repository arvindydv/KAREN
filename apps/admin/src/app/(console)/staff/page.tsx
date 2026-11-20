import { Card } from '@karen/ui/web';
import { requireStaffSession } from '@/lib/staff-session';
import { StaffAccountActions } from './staff-account-actions';

export const metadata = { title: 'Staff accounts' };

export default async function StaffAccountsPage() {
  await requireStaffSession();
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">Staff account actions</h1>
      <p className="text-sm text-muted">
        Requires <code>staff:manage</code> and a fresh security-key confirmation. You cannot change
        your own grants. Every action is audited.
      </p>
      <StaffAccountActions />
    </Card>
  );
}
