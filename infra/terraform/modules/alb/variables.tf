variable "name_prefix" {
  description = "Prefix for resource names, e.g. karen-dev."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for target groups."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets for the internet-facing ALB."
  type        = list(string)
}

variable "security_group_id" {
  description = "ALB security group (ingress restricted to edge CIDRs)."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN (same region as the ALB) for the HTTPS listener."
  type        = string

  validation {
    condition     = can(regex("^arn:aws[a-zA-Z-]*:acm:[a-z0-9-]+:[0-9]{12}:certificate/.+$", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate ARN."
  }
}

variable "ssl_policy" {
  description = "TLS security policy for the HTTPS listener."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "idle_timeout" {
  description = "Connection idle timeout in seconds. 120s accommodates SSE chat streams with periodic heartbeats."
  type        = number
  default     = 120

  validation {
    condition     = var.idle_timeout >= 60 && var.idle_timeout <= 4000
    error_message = "idle_timeout must be between 60 and 4000 seconds."
  }
}

variable "access_logs_bucket" {
  description = "S3 bucket name for ALB access logs (must allow ELB log delivery, SSE-S3)."
  type        = string
}

variable "deletion_protection" {
  description = "Enable ALB deletion protection."
  type        = bool
  default     = true
}

variable "hsts_header_value" {
  description = "Strict-Transport-Security header value added to HTTPS responses (null to leave to the application/Cloudflare)."
  type        = string
  default     = "max-age=31536000; includeSubDomains"
}

variable "waf_web_acl_arn" {
  description = "Optional regional WAFv2 web ACL to associate (KAREN relies on Cloudflare WAF by default)."
  type        = string
  default     = null
}

variable "targets" {
  description = <<-EOT
    Target groups and listener rules, keyed by short service name (<= 15 chars).
    Each rule matches host_headers AND (optionally) path_patterns AND (optionally) source_ips.
    ALB allows at most 5 condition values per rule in total.
  EOT
  type = map(object({
    port              = number
    health_check_path = string
    priority          = number
    host_headers      = list(string)
    path_patterns     = optional(list(string), [])
    source_ips        = optional(list(string), [])
  }))

  validation {
    condition     = alltrue([for k, t in var.targets : length(t.host_headers) + length(t.path_patterns) + length(t.source_ips) <= 5 && length(t.host_headers) > 0])
    error_message = "Each target needs at least one host header and at most 5 condition values in total."
  }

  validation {
    condition     = length(distinct([for t in values(var.targets) : t.priority])) == length(var.targets)
    error_message = "Listener rule priorities must be unique."
  }
}

variable "blocked_path_patterns" {
  description = <<-EOT
    Paths answered with 404 on EVERY host before any forward rule (defence in depth): service-to-
    service routes such as the API's /internal/* data-rights steps are never public. The API
    authenticates them itself (signed requests); this keeps them off the internet entirely.
  EOT
  type        = list(string)
  default     = ["/internal/*"]

  validation {
    condition     = length(var.blocked_path_patterns) <= 5
    error_message = "At most 5 blocked path patterns (ALB condition limit)."
  }
}
