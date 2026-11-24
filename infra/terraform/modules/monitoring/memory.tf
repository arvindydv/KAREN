# Phase 03 memory observability (ADR-0036 §12.1, L-09; M7). Disabled by default: the API emits
# karen_memory_* through OpenTelemetry, but no OTel → CloudWatch export is deployed yet, so these
# would alarm on missing data. Enable together with that pipeline and APP-4. Metric dimensions are
# the low-cardinality labels the API emits (never user identifiers).

locals {
  memory_ns = var.app_metrics_namespace
  memory_alarm_defs = {
    # A memory write in finalize() or a workflow start failed (reply still committed).
    enqueue_failures = {
      metric = "karen_memory_job_enqueue_failures_total", stat = "Sum", threshold = 0,
      period = 300, periods = 1, desc = "Memory job enqueue/start failures (finalize or start)", dims = {}
    }
    # Non-terminal jobs had to be terminated after the DB-held max age (H7): a workflow problem.
    stale_terminations = {
      metric = "karen_memory_jobs_stale_terminated_total", stat = "Sum", threshold = 0,
      period = 3600, periods = 1, desc = "Extraction jobs terminated as stale", dims = {}
    }
    # Items dropped by wire validation should never happen (write-time policy is the primary guard).
    retrieval_drops = {
      metric = "karen_memory_retrieval_dropped_total", stat = "Sum", threshold = 0,
      period = 300, periods = 1, desc = "Retrieved memories dropped by wire validation", dims = {}
    }
    # Retrieval latency (target p95 < 150 ms, arch §6.7).
    retrieval_latency = {
      metric = "karen_memory_retrieval_duration_ms", stat = "p95", threshold = 150,
      period = 300, periods = 3, desc = "Memory retrieval p95 above 150 ms", dims = {}
    }
    # Re-kick could not even call start (Temporal unreachable).
    rekick_failures = {
      metric = "karen_memory_rekick_total", stat = "Sum", threshold = 0,
      period = 900, periods = 1, desc = "Memory re-kick start failures", dims = { result = "start_failed" }
    }
  }
  memory_alarms = { for k, v in local.memory_alarm_defs : k => v if var.memory_alarms_enabled }
}

resource "aws_cloudwatch_metric_alarm" "memory" {
  for_each = local.memory_alarms

  alarm_name          = "${var.name_prefix}-memory-${replace(each.key, "_", "-")}"
  alarm_description   = "${each.value.desc} (Phase 03 memory; runbook docs/runbooks/memory-operations.md)"
  namespace           = local.memory_ns
  metric_name         = each.value.metric
  dimensions          = length(each.value.dims) > 0 ? each.value.dims : null
  extended_statistic  = startswith(each.value.stat, "p") ? each.value.stat : null
  statistic           = startswith(each.value.stat, "p") ? null : each.value.stat
  period              = each.value.period
  evaluation_periods  = each.value.periods
  comparison_operator = "GreaterThanThreshold"
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_dashboard" "memory" {
  count          = var.memory_alarms_enabled ? 1 : 0
  dashboard_name = "${var.name_prefix}-memory"
  dashboard_body = jsonencode({
    widgets = [
      for i, w in [
        { title = "Retrieval outcomes by memory_status", metrics = [["${local.memory_ns}", "karen_memory_retrieval_outcome_total"]], stat = "Sum" },
        { title = "Retrieval duration p95 (ms)", metrics = [["${local.memory_ns}", "karen_memory_retrieval_duration_ms"]], stat = "p95" },
        { title = "Retrieval drops (wire validation)", metrics = [["${local.memory_ns}", "karen_memory_retrieval_dropped_total"]], stat = "Sum" },
        { title = "Extraction jobs by outcome", metrics = [["${local.memory_ns}", "karen_memory_extraction_jobs_total"]], stat = "Sum" },
        { title = "Candidate decisions", metrics = [["${local.memory_ns}", "karen_memory_candidates_total"]], stat = "Sum" },
        { title = "Rejections by class", metrics = [["${local.memory_ns}", "karen_memory_rejections_total"]], stat = "Sum" },
        { title = "Enqueue failures", metrics = [["${local.memory_ns}", "karen_memory_job_enqueue_failures_total"]], stat = "Sum" },
        { title = "Stale terminations / re-kicks", metrics = [["${local.memory_ns}", "karen_memory_jobs_stale_terminated_total"], ["${local.memory_ns}", "karen_memory_rekick_total"]], stat = "Sum" },
        { title = "Purge deleted rows by category", metrics = [["${local.memory_ns}", "karen_memory_purge_deleted_total"]], stat = "Sum" },
        { title = "Extraction cost (micro-USD)", metrics = [["${local.memory_ns}", "karen_memory_extraction_cost_micro_usd_total"]], stat = "Sum" },
        ] : {
        type   = "metric"
        x      = (i % 2) * 12
        y      = floor(i / 2) * 6
        width  = 12
        height = 6
        properties = {
          title   = w.title
          metrics = w.metrics
          stat    = w.stat
          period  = 300
          region  = data.aws_region.current.region
          view    = "timeSeries"
        }
      }
    ]
  })
}

data "aws_region" "current" {}
