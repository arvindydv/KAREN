import { adminSystemStatusSchema } from '@karen/api-contracts';
import { Card, StatusBadge } from '@karen/ui/web';
import { staffApi } from '@/lib/api';
import { onUnauthenticated, requireStaffSession } from '@/lib/staff-session';

export const metadata = { title: 'System status' };

export default async function SystemStatusPage() {
  const session = await requireStaffSession();
  const { data, error, response } = await staffApi(session.token).GET('/v1/admin/system/status');
  onUnauthenticated(response.status);
  if (!data) {
    return (
      <Card role="alert">
        <h1 className="text-xl font-semibold">Unable to load system status</h1>
        <p className="text-sm text-muted">
          {response.status === 403
            ? 'You do not have permission to view system status.'
            : (error?.error.message ?? 'The staff API returned an error.')}{' '}
          (status {response.status}
          {error ? `, reference ${error.error.correlation_id}` : ''})
        </p>
      </Card>
    );
  }
  const status = adminSystemStatusSchema.parse(data);
  return (
    <Card className="space-y-2">
      <h1 className="text-xl font-semibold">System status</h1>
      <p>Environment: {status.environment}</p>
      <p>AI gateway mode: {status.ai_gateway_mode}</p>
      <StatusBadge
        tone={status.execution_paused ? 'danger' : 'success'}
        label={status.execution_paused ? 'Execution paused' : 'Execution enabled'}
      />
      <p className="text-xs text-muted">Generated {status.generated_at}</p>
    </Card>
  );
}
