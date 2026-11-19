variable "name_prefix" {
  description = "Prefix for resource names, e.g. karen-dev."
  type        = string
}

variable "archive_retention_days" {
  description = "Days to retain archived domain events for replay (0 = indefinitely)."
  type        = number
  default     = 14
}

variable "routes" {
  description = "Rules routing domain events to SQS queues, keyed by route name. Matches on event source (e.g. karen.tasks) and optional detail-types."
  type = map(object({
    sources      = list(string)
    detail_types = optional(list(string), [])
    queue_arn    = string
  }))
  default = {}

  validation {
    condition     = alltrue([for r in values(var.routes) : alltrue([for s in r.sources : startswith(s, "karen.")])])
    error_message = "Domain event sources must use the karen.* namespace."
  }
}
