data "aws_caller_identity" "current" {}

# ------------------------------------------------------------ log groups --

resource "aws_cloudwatch_log_group" "service" {
  for_each = var.service_names

  name              = "/karen/${var.name_prefix}/ecs/${each.value}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
}

# ------------------------------------------------------------ alert topic --

resource "aws_sns_topic" "alerts" {
  name              = "${var.name_prefix}-alerts"
  kms_master_key_id = var.messaging_kms_key_arn
}

data "aws_iam_policy_document" "alerts" {
  statement {
    sid       = "AllowCloudWatchAndBudgets"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts.json
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.alert_email_addresses)

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  actions = [aws_sns_topic.alerts.arn]
}

# -------------------------------------------------------------- ALB alarms --

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.name_prefix}-alb-5xx"
  alarm_description   = "ALB-generated plus target 5xx responses above threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.alb_5xx_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions

  metric_query {
    id          = "total"
    expression  = "FILL(elb, 0) + FILL(target, 0)"
    label       = "5xx total"
    return_data = true
  }

  metric_query {
    id = "elb"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_ELB_5XX_Count"
      period      = 300
      stat        = "Sum"
      dimensions  = { LoadBalancer = var.alb_arn_suffix }
    }
  }

  metric_query {
    id = "target"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      period      = 300
      stat        = "Sum"
      dimensions  = { LoadBalancer = var.alb_arn_suffix }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_targets" {
  for_each = var.target_group_arn_suffixes

  alarm_name          = "${var.name_prefix}-${each.key}-unhealthy-targets"
  alarm_description   = "Unhealthy targets behind the ALB for ${each.key}"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = each.value
  }
}

# -------------------------------------------------------------- ECS alarms --

resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  for_each = var.service_names

  alarm_name          = "${var.name_prefix}-${each.value}-cpu-high"
  alarm_description   = "${each.value} average CPU high (autoscaling may be at max)"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.ecs_cpu_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory" {
  for_each = var.service_names

  alarm_name          = "${var.name_prefix}-${each.value}-memory-high"
  alarm_description   = "${each.value} average memory high"
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.ecs_memory_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value
  }
}

# -------------------------------------------------------------- RDS alarms --

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU high"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.rds_cpu_threshold
  alarm_actions       = local.actions
  ok_actions          = local.actions
  dimensions          = { DBInstanceIdentifier = var.rds_identifier }
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${var.name_prefix}-rds-free-storage-low"
  alarm_description   = "RDS free storage below 15% of allocated (autoscaling may be at its ceiling)"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = floor(var.rds_allocated_storage_gib * 0.15 * 1073741824)
  alarm_actions       = local.actions
  ok_actions          = local.actions
  dimensions          = { DBInstanceIdentifier = var.rds_identifier }
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${var.name_prefix}-rds-connections-high"
  alarm_description   = "RDS connection count high (check pool sizes / add RDS Proxy)"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.rds_connections_threshold
  alarm_actions       = local.actions
  ok_actions          = local.actions
  dimensions          = { DBInstanceIdentifier = var.rds_identifier }
}

# ------------------------------------------------------ messaging alarms --

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  for_each = var.dlq_names

  alarm_name          = "${var.name_prefix}-${each.key}-dlq-not-empty"
  alarm_description   = "Messages in DLQ ${each.value}: investigate and redrive"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  dimensions          = { QueueName = each.value }
}

resource "aws_cloudwatch_metric_alarm" "eventbridge_failed" {
  for_each = var.eventbridge_rule_names

  alarm_name          = "${var.name_prefix}-${each.key}-eventbridge-failed"
  alarm_description   = "EventBridge rule ${each.value} failed to deliver events"
  namespace           = "AWS/Events"
  metric_name         = "FailedInvocations"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  dimensions          = { RuleName = each.value }
}

# ------------------------------------------------------------------ budget --

resource "aws_budgets_budget" "monthly" {
  count = var.budget_monthly_limit_usd == null ? 0 : 1

  name         = "${var.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_monthly_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Environment$%s", var.budget_environment_tag)]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }
}
