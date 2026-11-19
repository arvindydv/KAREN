variable "name_prefix" {
  description = "Prefix for resource names, e.g. karen-dev."
  type        = string
}

variable "subnet_ids" {
  description = "Isolated database subnet IDs (at least two AZs)."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "RDS subnet groups need subnets in at least two AZs."
  }
}

variable "security_group_id" {
  description = "Security group for the DB instance."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL version. A major version (\"17\") lets RDS pick the current default minor."
  type        = string
  default     = "17"

  validation {
    condition     = startswith(var.engine_version, "17")
    error_message = "KAREN standardises on PostgreSQL 17."
  }
}

variable "instance_class" {
  description = "DB instance class, e.g. db.t4g.small (dev) or db.m7g.large (production)."
  type        = string
}

variable "allocated_storage" {
  description = "Initial gp3 storage in GiB."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB."
  type        = number
  default     = 100
}

variable "multi_az" {
  description = "Deploy a synchronous standby in another AZ."
  type        = bool
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "karen"
}

variable "master_username" {
  description = "Master username (password is generated and stored by RDS in Secrets Manager). Applications must NOT use the master user."
  type        = string
  default     = "karen_admin"
}

variable "secrets_kms_key_arn" {
  description = "CMK for the RDS-managed master user secret."
  type        = string
}

variable "data_kms_key_arn" {
  description = "CMK for storage, snapshots and Performance Insights."
  type        = string
}

variable "logs_kms_key_arn" {
  description = "CMK for the exported PostgreSQL log group."
  type        = string
}

variable "log_retention_days" {
  description = "Retention for exported PostgreSQL logs."
  type        = number
  default     = 30
}

variable "backup_retention_period" {
  description = "Automated backup retention (days); enables PITR."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_period >= 1 && var.backup_retention_period <= 35
    error_message = "backup_retention_period must be 1-35 days (0 would disable PITR)."
  }
}

variable "deletion_protection" {
  description = "Block deletion of the instance."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip the final snapshot on destroy (dev only)."
  type        = bool
  default     = false
}

variable "performance_insights_enabled" {
  description = "Enable Performance Insights / Database Insights (standard). Not available on the smallest burstable classes."
  type        = bool
  default     = true
}

variable "performance_insights_retention_period" {
  description = "Performance Insights retention in days (7 = free tier)."
  type        = number
  default     = 7
}

variable "monitoring_interval" {
  description = "Enhanced Monitoring interval in seconds (0 disables)."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1, 5, 10, 15, 30, 60], var.monitoring_interval)
    error_message = "monitoring_interval must be one of 0, 1, 5, 10, 15, 30, 60."
  }
}

variable "log_min_duration_statement_ms" {
  description = "Log statements slower than this (ms). -1 disables. Beware: logged SQL can contain personal data in literals."
  type        = number
  default     = 1000
}

variable "maintenance_window" {
  description = "Weekly maintenance window (UTC). Default is Sunday ~03:30-04:30 IST."
  type        = string
  default     = "sat:22:00-sat:23:00"
}

variable "backup_window" {
  description = "Daily backup window (UTC), must not overlap the maintenance window."
  type        = string
  default     = "20:00-21:00"
}
