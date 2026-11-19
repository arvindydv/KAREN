# Domain-event bus fed by the transactional outbox relay (architecture §8).
# Encryption: the bus uses EventBridge's default AWS-owned key. Customer
# managed keys on buses need extra key-policy/encryption-context handling that
# we have not verified end-to-end; revisit if events carry personal data
# (they should carry IDs, not content).

resource "aws_cloudwatch_event_bus" "this" {
  name        = "${var.name_prefix}-domain"
  description = "KAREN domain events (outbox relay -> routed consumers)"
}

resource "aws_cloudwatch_event_archive" "this" {
  name             = "${var.name_prefix}-domain-archive"
  description      = "Replayable archive of KAREN domain events"
  event_source_arn = aws_cloudwatch_event_bus.this.arn
  retention_days   = var.archive_retention_days
}

resource "aws_cloudwatch_event_rule" "this" {
  for_each = var.routes

  name           = "${var.name_prefix}-${each.key}"
  description    = "Route ${join(",", each.value.sources)} events to SQS"
  event_bus_name = aws_cloudwatch_event_bus.this.name

  event_pattern = jsonencode(merge(
    { source = each.value.sources },
    length(each.value.detail_types) > 0 ? { "detail-type" = each.value.detail_types } : {},
  ))
}

resource "aws_cloudwatch_event_target" "this" {
  for_each = var.routes

  rule           = aws_cloudwatch_event_rule.this[each.key].name
  event_bus_name = aws_cloudwatch_event_bus.this.name
  target_id      = "sqs"
  arn            = each.value.queue_arn

  retry_policy {
    maximum_event_age_in_seconds = 86400
    maximum_retry_attempts       = 185
  }
}
