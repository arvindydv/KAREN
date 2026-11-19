export * from './correlation.js';
export * from './redaction.js';
export * from './logger.js';

/** Canonical span/metric attribute names shared by all KAREN services. */
export const ATTR = {
  REQUEST_ID: 'karen.request_id',
  USER_REF: 'karen.user_ref',
  TASK_ID: 'karen.task_id',
  WORKFLOW_ID: 'karen.workflow_id',
  PROVIDER_OPERATION_ID: 'karen.provider_operation_id',
  APPROVAL_ID: 'karen.approval_id',
  ROUTE_TIER: 'karen.ai.route_tier',
  MODEL_REQUESTED: 'karen.ai.requested_model',
  MODEL_SERVED: 'karen.ai.served_model',
  COST_USD_ESTIMATED: 'karen.ai.estimated_cost_usd',
} as const;
