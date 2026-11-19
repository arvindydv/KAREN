variable "bucket_name" {
  description = "Globally unique bucket name."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name must be a valid S3 bucket name."
  }
}

variable "kms_key_arn" {
  description = "CMK ARN for SSE-KMS. null = SSE-S3 (required for ALB access-log buckets, which do not support SSE-KMS)."
  type        = string
  default     = null
}

variable "versioning_enabled" {
  description = "Enable object versioning."
  type        = bool
  default     = true
}

variable "expiration_days" {
  description = "Expire current object versions after N days (null = keep)."
  type        = number
  default     = null
}

variable "noncurrent_version_expiration_days" {
  description = "Permanently delete noncurrent versions after N days."
  type        = number
  default     = 30
}

variable "transition_to_ia_days" {
  description = "Transition current versions to STANDARD_IA after N days (null = never; must be >= 30)."
  type        = number
  default     = null

  validation {
    condition     = var.transition_to_ia_days == null || try(var.transition_to_ia_days >= 30, false)
    error_message = "transition_to_ia_days must be null or >= 30."
  }
}

variable "enable_alb_log_delivery" {
  description = "Add the bucket policy statements that let Elastic Load Balancing write access logs."
  type        = bool
  default     = false
}

variable "enable_s3_access_log_delivery" {
  description = "Allow S3 server access logs from other buckets in this account to be delivered here (log bucket only)."
  type        = bool
  default     = false
}

variable "access_logging" {
  description = "S3 server access logging target ({ target_bucket = \"...\" }); null disables. Target must be SSE-S3 and allow log delivery. An object (not a bare string) so enabling is known at plan time even when the bucket name is not."
  type = object({
    target_bucket = string
  })
  default = null
}

variable "cors_allowed_origins" {
  description = "Origins allowed to use presigned URLs from browsers (empty = no CORS configuration)."
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.cors_allowed_origins, "*")
    error_message = "Wildcard CORS origins are not allowed."
  }
}

variable "force_destroy" {
  description = "Allow destroying a non-empty bucket. Keep false outside throwaway environments."
  type        = bool
  default     = false
}

variable "data_classification" {
  description = "DataClassification tag value (e.g. confidential, restricted, internal)."
  type        = string
}
