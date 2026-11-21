import { Card, StatusBadge } from '@karen/ui/web';
import { requireStaffSession } from '@/lib/staff-session';

export const metadata = { title: 'My account' };

/** Server-rendered per request; evaluated outside render for React purity rules. */
const isFuture = (iso: string) => new Date(iso).getTime() > Date.now();

const when = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

export default async function AccountPage() {
  const { me } = await requireStaffSession();
  const stepUpValid = isFuture(me.step_up_valid_until);
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">My account</h1>
      <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Name</dt>
        <dd>{me.display_name}</dd>
        <dt className="text-muted">E-mail</dt>
        <dd>{me.email}</dd>
        <dt className="text-muted">Staff id</dt>
        <dd className="font-mono">{me.id}</dd>
        <dt className="text-muted">Roles</dt>
        <dd>{me.roles.length ? me.roles.join(', ') : 'none'}</dd>
        <dt className="text-muted">Elevated (time-boxed)</dt>
        <dd>{me.elevated_roles.length ? me.elevated_roles.join(', ') : 'none'}</dd>
        <dt className="text-muted">Permissions</dt>
        <dd>{me.permissions.length ? me.permissions.join(', ') : 'none'}</dd>
        <dt className="text-muted">Session expires</dt>
        <dd>{when(me.session_expires_at)}</dd>
        <dt className="text-muted">Step-up</dt>
        <dd className="flex items-center gap-2">
          <StatusBadge
            tone={stepUpValid ? 'success' : 'neutral'}
            label={stepUpValid ? 'Confirmed recently' : 'Required for sensitive actions'}
          />
          <span className="text-muted">valid until {when(me.step_up_valid_until)}</span>
        </dd>
      </dl>
      <p className="text-xs text-muted">
        Permissions shown here are informational; the API checks them on every request.
      </p>
    </Card>
  );
}
