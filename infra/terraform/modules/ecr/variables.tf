variable "name_prefix" {
  description = "Repository name prefix, e.g. karen-dev. Repositories are named <prefix>/<service>."
  type        = string
}

variable "repositories" {
  description = "Service names to create repositories for."
  type        = set(string)
}

variable "kms_key_arn" {
  description = "CMK ARN used for repository encryption (immutable after creation)."
  type        = string
}

variable "untagged_image_expiry_days" {
  description = "Expire untagged images after this many days."
  type        = number
  default     = 7
}

variable "max_tagged_images" {
  description = "Keep at most this many tagged images per repository (older ones expire)."
  type        = number
  default     = 50

  validation {
    condition     = var.max_tagged_images >= 5
    error_message = "Keep at least 5 tagged images so rollbacks remain possible."
  }
}

variable "force_delete" {
  description = "Allow destroying repositories that still contain images. Keep false outside throwaway environments."
  type        = bool
  default     = false
}
