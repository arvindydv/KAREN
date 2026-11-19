variable "name" {
  description = "Queue name (a -dlq queue is created alongside)."
  type        = string
}

variable "kms_key_arn" {
  description = "CMK ARN for SSE-KMS on both queues."
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "Visibility timeout; set to at least 6x the consumer's processing time."
  type        = number
  default     = 60

  validation {
    condition     = var.visibility_timeout_seconds >= 0 && var.visibility_timeout_seconds <= 43200
    error_message = "visibility_timeout_seconds must be 0-43200."
  }
}

variable "message_retention_seconds" {
  description = "Retention on the main queue."
  type        = number
  default     = 345600 # 4 days
}

variable "dlq_message_retention_seconds" {
  description = "Retention on the DLQ (keep long enough to investigate and redrive)."
  type        = number
  default     = 1209600 # 14 days (maximum)
}

variable "max_receive_count" {
  description = "Receives before a message moves to the DLQ."
  type        = number
  default     = 5

  validation {
    condition     = var.max_receive_count >= 1 && var.max_receive_count <= 1000
    error_message = "max_receive_count must be 1-1000."
  }
}

variable "receive_wait_time_seconds" {
  description = "Long-polling wait time."
  type        = number
  default     = 20
}

variable "eventbridge_source_arns" {
  description = "EventBridge rule ARNs allowed to send to this queue."
  type        = list(string)
  default     = []
}
