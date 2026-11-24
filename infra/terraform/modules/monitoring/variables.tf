variable "name_prefix" {
  description = "Prefix for resource names, e.g. karen-dev."
  type        = string
}

variable "logs_kms_key_arn" {
  description = "CMK for CloudWatch log groups."
  type        = string
}

variable "messaging_kms_key_arn" {
  description = "CMK for the SNS alerts topic."
  type        = string
}

variable "log_retention_days" {
  description = "Retention for service log groups."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a CloudWatch-supported retention value."
  }
}

variable "service_names" {
  description = "ECS service names; one log group and CPU/memory alarms are created per service."
  type        = set(string)
}

variable "ecs_cluster_name" {
  description = "ECS cluster name."
  type        = string
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix."
  type        = string
}

variable "target_group_arn_suffixes" {
  description = "Map of target name to target group ARN suffix (unhealthy-host alarms)."
  type        = map(string)
}

variable "rds_identifier" {
  description = "RDS instance identifier."
  type        = string
}

variable "rds_allocated_storage_gib" {
  description = "Allocated storage; the free-storage alarm fires below 15% of it."
  type        = number
}

variable "rds_connections_threshold" {
  description = "Alarm when DatabaseConnections exceeds this (set ~80% of max_connections for the instance class)."
  type        = number
}

variable "dlq_names" {
  description = "Map of logical name to SQS DLQ name; alarm when any message is visible."
  type        = map(string)
}

variable "eventbridge_rule_names" {
  description = "Map of route name to EventBridge rule name; alarm on FailedInvocations."
  type        = map(string)
  default     = {}
}

variable "alb_5xx_threshold" {
  description = "Alarm when ALB + target 5xx count exceeds this per 5 minutes."
  type        = number
  default     = 10
}

variable "ecs_cpu_threshold" {
  description = "ECS service average CPU % alarm threshold."
  type        = number
  default     = 85
}

variable "ecs_memory_threshold" {
  description = "ECS service average memory % alarm threshold."
  type        = number
  default     = 85
}

variable "rds_cpu_threshold" {
  description = "RDS CPU % alarm threshold."
  type        = number
  default     = 80
}

variable "alert_email_addresses" {
  description = "Email addresses subscribed to the alerts topic (each must confirm the subscription)."
  type        = list(string)
  default     = []
}

variable "budget_monthly_limit_usd" {
  description = "Monthly AWS cost budget in USD. null disables the budget."
  type        = number
  default     = null

  validation {
    condition     = var.budget_monthly_limit_usd == null || try(var.budget_monthly_limit_usd > 0, false)
    error_message = "budget_monthly_limit_usd must be null or positive."
  }
}

variable "budget_environment_tag" {
  description = "Value of the Environment cost-allocation tag the budget filters on (tag must be activated in Billing)."
  type        = string
}

# ── Phase 03 memory (ADR-0036 §12.1; M7) ──────────────────────────────────────────────────
variable "memory_alarms_enabled" {
  description = "Create the karen_memory_* dashboard and alarms. Keep false until the API's OpenTelemetry metrics are exported to CloudWatch (no such pipeline exists yet) AND memory is approved for the environment (APP-4)."
  type        = bool
  default     = false
}

variable "app_metrics_namespace" {
  description = "CloudWatch namespace the API's OpenTelemetry metrics are exported to (e.g. by an EMF exporter)."
  type        = string
  default     = "KAREN/App"
}
