variable "name_prefix" {
  description = "Prefix for resource names, e.g. karen-dev."
  type        = string
}

variable "engine" {
  description = <<-EOT
    Cache engine. Default "valkey": Valkey is the Linux Foundation fork of Redis OSS 7.2,
    wire/protocol-compatible with Redis clients (ioredis, redis-py), and ElastiCache prices
    Valkey nodes lower than Redis OSS nodes. KAREN uses Redis only for rate limits, short-lived
    session state and caches (architecture §8), which Valkey covers fully.
  EOT
  type        = string
  default     = "valkey"

  validation {
    condition     = contains(["valkey", "redis"], var.engine)
    error_message = "engine must be valkey or redis."
  }
}

variable "engine_version" {
  description = "Engine version (e.g. 8.0 for valkey, 7.1 for redis)."
  type        = string
  default     = "8.0"
}

variable "parameter_group_name" {
  description = "Parameter group (must match engine/major version)."
  type        = string
  default     = "default.valkey8"
}

variable "node_type" {
  description = "Cache node type, e.g. cache.t4g.small."
  type        = string
}

variable "num_cache_clusters" {
  description = "Number of nodes (1 primary + replicas). Multi-AZ requires >= 2."
  type        = number
  default     = 1
}

variable "multi_az" {
  description = "Enable Multi-AZ with automatic failover (requires num_cache_clusters >= 2)."
  type        = bool
  default     = false
}

variable "subnet_ids" {
  description = "Isolated database subnet IDs."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group for the cache nodes."
  type        = string
}

variable "data_kms_key_arn" {
  description = "CMK for encryption at rest."
  type        = string
}

variable "secrets_kms_key_arn" {
  description = "CMK for the AUTH token secret."
  type        = string
}

variable "logs_kms_key_arn" {
  description = "CMK for the slow-log log group."
  type        = string
}

variable "log_retention_days" {
  description = "Retention for the slow log."
  type        = number
  default     = 30
}

variable "snapshot_retention_limit" {
  description = "Days of automatic snapshots (0 disables). Redis holds only ephemeral data, so short retention is fine."
  type        = number
  default     = 1
}

variable "auth_token_version" {
  description = "Increment to rotate the AUTH token: a new random token is written to Secrets Manager and pushed to the cluster in the same apply (strategy ROTATE keeps the old token valid until the next rotation)."
  type        = number
  default     = 1
}

variable "secret_recovery_window_in_days" {
  description = "Recovery window for the AUTH token secret."
  type        = number
  default     = 30
}

variable "maintenance_window" {
  description = "Weekly maintenance window (UTC)."
  type        = string
  default     = "sun:00:00-sun:01:00"
}
