import { Card } from '@karen/ui/web';
import { requireStaffSession } from '@/lib/staff-session';
import { InvitationForm } from './invitation-form';

export const metadata = { title: 'Invitations' };

export default async function InvitationsPage() {
  await requireStaffSession();
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">Invite a staff member</h1>
      <p className="text-sm text-muted">
        Requires <code>staff:manage</code> and a fresh security-key confirmation. The invitee
        enrolls their own security key and password using a single-use link valid for 24 hours.
      </p>
      <InvitationForm />
    </Card>
  );
}
