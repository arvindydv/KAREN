variable "name_prefix" {
  description = "Prefix for KMS aliases, e.g. karen-dev."
  type        = string
}

variable "deletion_window_in_days" {
  description = "Waiting period before a scheduled key deletion completes."
  type        = number
  default     = 30

  validation {
    condition     = var.deletion_window_in_days >= 7 && var.deletion_window_in_days <= 30
    error_message = "deletion_window_in_days must be between 7 and 30."
  }
}

variable "key_administrator_arns" {
  description = "Optional IAM principal ARNs allowed to administer (not use) the keys. When empty, administration is delegated to IAM in this account via the account root principal."
  type        = list(string)
  default     = []
}
