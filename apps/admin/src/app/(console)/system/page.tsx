import { createKarenApiClient } from '@karen/api-contracts/client';
import { Card, StatusBadge } from '@karen/ui/web';
import { publicEnv } from '@/lib/env';
import { requireStaffSession } from '@/lib/staff-session';

export const metadata = { title: 'System status' };

export default async function SystemStatusPage() {
  const session = await requireStaffSession();
  const api = createKarenApiClient({
    baseUrl: publicEnv.NEXT_PUBLIC_API_BASE_URL,
    getAccessToken: () => session.accessToken,
  });
  const { data, error, response } = await api.GET('/v1/admin/system/status');
  if (error) {
    return (
      <Card role="alert">
        <h1 className="text-xl font-semibold">Unable to load system status</h1>
        <p className="text-sm text-muted">
          {error.error.message} (status {response.status}, reference {error.error.correlation_id})
        </p>
      </Card>
    );
  }
  return (
    <Card className="space-y-2">
      <h1 className="text-xl font-semibold">System status</h1>
      <p>Environment: {data.environment}</p>
      <StatusBadge
        tone={data.execution_paused ? 'danger' : 'success'}
        label={data.execution_paused ? 'Execution paused' : 'Execution enabled'}
      />
    </Card>
  );
}
