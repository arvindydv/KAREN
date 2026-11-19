variable "name_prefix" {
  description = "Secret path prefix, e.g. karen/dev. Secrets are named <prefix>/<id>."
  type        = string
}

variable "kms_key_arn" {
  description = "CMK ARN used to encrypt the secrets."
  type        = string
}

variable "secrets" {
  description = "Secret containers to create, keyed by id (e.g. shared/INTERNAL_SERVICE_HMAC_SECRET, ai-service/AI_GATEWAY_API_KEY). Values are NEVER set by Terraform."
  type = map(object({
    description = string
  }))

  validation {
    condition     = alltrue([for k in keys(var.secrets) : can(regex("^[a-z0-9-]+/[A-Z0-9_]+$", k))])
    error_message = "Secret ids must look like <scope>/<UPPER_SNAKE_NAME>."
  }
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable (7-30)."
  type        = number
  default     = 30

  validation {
    condition     = var.recovery_window_in_days >= 7 && var.recovery_window_in_days <= 30
    error_message = "recovery_window_in_days must be 7-30."
  }
}
