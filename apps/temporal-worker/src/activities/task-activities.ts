import { createLogger } from '@karen/observability';
import type { TaskActivities } from './types.js';

const log = createLogger({
  service: 'karen-temporal-worker',
  environment: process.env.APP_ENV ?? 'local',
});

export const createTaskActivities = (): TaskActivities => ({
  recordTaskTransition(input) {
    // Metadata only — never payloads or personal data.
    log.info(
      {
        task_id: input.taskId,
        from: input.from,
        to: input.to,
        version: input.version,
        reason: input.reason,
      },
      'task.transition',
    );
    return Promise.resolve();
  },
});
