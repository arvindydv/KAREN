import { createEventCounter, createValueHistogram } from '@karen/observability';

/**
 * `karen_memory_*` metrics (arch §12.1). OpenTelemetry API only (no-ops until a meter provider is
 * installed). Attributes come from FIXED vocabularies — never user ids, memory text, slots or
 * labels. Created lazily so they bind to the provider installed at boot.
 */
type CounterName =
  | 'karen_memory_retrieval_outcome_total'
  | 'karen_memory_retrieval_dropped_total'
  | 'karen_memory_job_enqueue_failures_total'
  | 'karen_memory_last_used_update_failures_total'
  | 'karen_memory_extraction_jobs_total'
  | 'karen_memory_candidates_total'
  | 'karen_memory_rejections_total'
  | 'karen_memory_extraction_cost_micro_usd_total'
  | 'karen_memory_purge_deleted_total'
  | 'karen_memory_rekick_total'
  | 'karen_memory_jobs_stale_terminated_total';
type HistogramName = 'karen_memory_retrieval_duration_ms' | 'karen_memory_retrieval_items';

const COUNTERS: Record<CounterName, string> = {
  karen_memory_retrieval_outcome_total: 'Retrieval outcomes per turn, by memory_status',
  karen_memory_retrieval_dropped_total: 'Retrieved items dropped before sending, by reason',
  karen_memory_job_enqueue_failures_total: 'Memory writes in finalize/start that failed, by stage',
  karen_memory_last_used_update_failures_total: 'Post-commit last_used_at updates that failed',
  karen_memory_extraction_jobs_total: 'Extraction jobs finished, by outcome_code and is_mock',
  karen_memory_candidates_total: 'Extraction candidates by decision and kind',
  karen_memory_rejections_total: 'Rejected extraction candidates by class',
  karen_memory_extraction_cost_micro_usd_total: 'Extraction cost (micro-USD), by is_mock',
  karen_memory_purge_deleted_total: 'Rows deleted by the retention purge, by category',
  karen_memory_rekick_total: 'Re-kick workflow starts, by result',
  karen_memory_jobs_stale_terminated_total: 'Non-terminal jobs terminated after the max age',
};
const HISTOGRAMS: Record<HistogramName, [string, string]> = {
  karen_memory_retrieval_duration_ms: ['Retrieval duration per turn, by status', 'ms'],
  karen_memory_retrieval_items: ['Items sent per turn, by reason', '{item}'],
};

const counters = new Map<CounterName, ReturnType<typeof createEventCounter>>();
const histograms = new Map<HistogramName, ReturnType<typeof createValueHistogram>>();

export function memoryCount(name: CounterName, attributes: Record<string, string> = {}, value = 1) {
  if (value === 0) return;
  let c = counters.get(name);
  if (!c) {
    c = createEventCounter('karen-api', name, COUNTERS[name]);
    counters.set(name, c);
  }
  c.add(value, attributes);
}

export function memoryObserve(
  name: HistogramName,
  value: number,
  attributes: Record<string, string> = {},
) {
  let h = histograms.get(name);
  if (!h) {
    const [description, unit] = HISTOGRAMS[name];
    h = createValueHistogram('karen-api', name, description, unit);
    histograms.set(name, h);
  }
  h.record(value, attributes);
}
