variable "name_prefix" {
  description = "Prefix for resource names, e.g. karen-dev."
  type        = string
}

variable "vpc_id" {
  description = "VPC used for the private Cloud Map DNS namespace."
  type        = string
}

variable "container_insights" {
  description = "Container Insights mode: enhanced, enabled or disabled."
  type        = string
  default     = "enabled"

  validation {
    condition     = contains(["enhanced", "enabled", "disabled"], var.container_insights)
    error_message = "container_insights must be enhanced, enabled or disabled."
  }
}
