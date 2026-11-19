/**
 * Task & approval wire contracts (product spec §28.3, §28.5). Defined now so the
 * Responsibility Engine, clients and workflows share one shape; endpoints arrive with the
 * Tasks feature (build order step 07+).
 */
import { ACTION_CATEGORIES, APPROVAL_STATUSES, RISK_LEVELS, TASK_STATES } from '@karen/domain';
import { z } from 'zod';

export const taskSourceSchema = z.enum([
  'CHAT',
  'QUICK_ACTION',
  'REMINDER',
  'PROACTIVE',
  'CONNECTED_EVENT',
  'MANUAL',
]);

export const createTaskRequestSchema = z
  .object({
    type: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    desired_outcome: z.string().min(1).max(2000),
    constraints: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    source: taskSourceSchema,
    /** Client-generated UUID for request de-duplication (idempotent create). */
    client_request_id: z.uuid(),
    deadline: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .meta({ id: 'CreateTaskRequest' });

export const moneySchema = z
  .object({ currency: z.string().length(3), value_minor: z.number().int().nonnegative() })
  .strict();

export const taskSummarySchema = z
  .object({
    id: z.uuid(),
    type: z.string(),
    state: z.enum(TASK_STATES),
    version: z.number().int().nonnegative(),
    desired_outcome: z.string(),
    provider_status: z.string().nullable(),
    payment_status: z.string().nullable(),
    deadline: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'TaskSummary' });

export const approvalSchema = z
  .object({
    approval_id: z.string(),
    task_id: z.string(),
    action_type: z.enum(ACTION_CATEGORIES),
    provider: z.string(),
    exact_summary: z.string(),
    payload_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    maximum_total_amount: moneySchema,
    expires_at: z.iso.datetime(),
    risk: z.enum(RISK_LEVELS),
    status: z.enum(APPROVAL_STATUSES),
  })
  .strict()
  .meta({ id: 'Approval' });

/** The only client-writable part of an approval: the decision itself. */
export const approvalDecisionRequestSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    payload_hash: z.string(),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .meta({ id: 'ApprovalDecisionRequest' });

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export type ApprovalDto = z.infer<typeof approvalSchema>;
