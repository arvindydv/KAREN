import { elevationSchema } from '@karen/api-contracts';
import { Card, StatusBadge } from '@karen/ui/web';
import { z } from 'zod';
import { staffApi } from '@/lib/api';
import { onUnauthenticated, requireStaffSession } from '@/lib/staff-session';
import { ElevationDecision } from './elevation-decision';
import { ElevationRequestForm } from './elevation-request-form';

export const metadata = { title: 'Elevations' };

const listSchema = z.object({ items: z.array(elevationSchema) });

export default async function ElevationsPage() {
  const session = await requireStaffSession();
  const { data, error, response } = await staffApi(session.token).GET('/v1/staff/elevations');
  onUnauthenticated(response.status);
  const list = data ? listSchema.parse(data).items : null;

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <h1 className="text-xl font-semibold">Request time-boxed elevation</h1>
        <p className="text-sm text-muted">
          Any staff member may request a role for 5–240 minutes with a reason and ticket. A
          different security admin must approve it. Requesting needs a security-key confirmation.
        </p>
        <ElevationRequestForm />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Elevation requests</h2>
        {list === null ? (
          <p role="alert" className="text-sm text-muted">
            {response.status === 403
              ? 'Reviewing elevations requires staff:manage.'
              : `Unable to load elevations (status ${response.status}${error ? `, reference ${error.error.correlation_id}` : ''}).`}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted">No elevation requests.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2">Requester</th>
                <th>Role</th>
                <th>Reason / ticket</th>
                <th>Status</th>
                <th>Requested</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id} className="border-t border-border align-top">
                  <td className="py-2 font-mono text-xs">
                    {item.staff_id === session.me.id ? 'you' : item.staff_id}
                  </td>
                  <td>{item.role}</td>
                  <td>
                    {item.reason}
                    <span className="block text-xs text-muted">{item.ticket_ref}</span>
                  </td>
                  <td>
                    <StatusBadge
                      tone={item.status === 'active' ? 'warning' : 'neutral'}
                      label={
                        item.expires_at && item.status === 'active'
                          ? `active until ${item.expires_at}`
                          : item.status
                      }
                    />
                  </td>
                  <td className="text-xs">{item.requested_at}</td>
                  <td>
                    {item.status === 'pending' ? (
                      <ElevationDecision
                        id={item.id}
                        ownRequest={item.staff_id === session.me.id}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
