variable "name_prefix" {
  description = "Prefix for role names, e.g. karen-dev."
  type        = string
}

variable "secrets_kms_key_arn" {
  description = "CMK protecting Secrets Manager secrets."
  type        = string
}

variable "data_kms_key_arn" {
  description = "CMK protecting S3 data buckets and ECR."
  type        = string
}

variable "messaging_kms_key_arn" {
  description = "CMK protecting SQS queues."
  type        = string
}

variable "services" {
  description = <<-EOT
    Per-service permissions. Each service gets its own execution role (image pull,
    its own log group, its own secrets) and task role (its own queues, buckets, bus).
  EOT
  type = map(object({
    ecr_repository_arn   = string
    log_group_arn        = string
    secret_arns          = optional(list(string), [])
    s3_read_bucket_arns  = optional(list(string), [])
    s3_write_bucket_arns = optional(list(string), [])
    sqs_send_arns        = optional(list(string), [])
    sqs_consume_arns     = optional(list(string), [])
    event_bus_arns       = optional(list(string), [])
    rds_iam_db_user      = optional(string)
    enable_execute_cmd   = optional(bool, false)
  }))
}

variable "rds_resource_id" {
  description = "RDS DbiResourceId, used to scope rds-db:connect for services that set rds_iam_db_user."
  type        = string
  default     = null
}
