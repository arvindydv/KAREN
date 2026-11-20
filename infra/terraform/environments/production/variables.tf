# Environment: production. Defaults here encode the production sizing profile; account-
# specific values (certificate ARN, hostnames, image tags, CIDRs) have no
# default and must come from terraform.tfvars (see terraform.tfvars.example).

# ------------------------------------------------------------------ general --

variable "environment" {
  description = "Environment name; must match the APP_ENV values the apps accept."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be dev, staging or production."
  }
}

variable "aws_region" {
  description = "AWS region. KAREN's primary region is Mumbai (ap-south-1)."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region must look like ap-south-1."
  }
}

variable "allowed_account_ids" {
  description = "AWS account IDs this environment may be applied to (provider guard against applying to the wrong account). Empty list disables the guard."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for a in var.allowed_account_ids : can(regex("^[0-9]{12}$", a))])
    error_message = "allowed_account_ids must be 12-digit account IDs."
  }
}

variable "app_log_level" {
  description = "LOG_LEVEL passed to all services."
  type        = string
  default     = "info"

  validation {
    condition     = contains(["trace", "debug", "info", "warn", "error"], var.app_log_level)
    error_message = "app_log_level must be trace, debug, info, warn or error."
  }
}

# ---------------------------------------------------------------- network --

variable "vpc_cidr" {
  description = "VPC CIDR (unique per environment to allow future peering)."
  type        = string
  default     = "10.30.0.0/16"
}

variable "az_count" {
  description = "Number of AZs."
  type        = number
  default     = 3
}

variable "single_nat_gateway" {
  description = "One shared NAT gateway (cheaper, single-AZ egress) instead of one per AZ."
  type        = bool
  default     = false
}

variable "enable_interface_endpoints" {
  description = "Create interface VPC endpoints (ECR, Secrets Manager, Logs, SQS)."
  type        = bool
  default     = true
}

# ------------------------------------------------------------------- edge --

variable "alb_ingress_ipv4_cidrs" {
  description = "CIDRs allowed to reach the ALB. Use Cloudflare's published IPv4 ranges (https://www.cloudflare.com/ips-v4) so the origin only accepts traffic via Cloudflare."
  type        = list(string)
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN in aws_region covering api_hostname (and web/admin hostnames if enabled)."
  type        = string
}

variable "api_hostname" {
  description = "Public API hostname, e.g. api.example.com."
  type        = string
}

variable "webhooks_hostname" {
  description = "Hostname for provider webhooks (/webhooks/*). null = same as api_hostname."
  type        = string
  default     = null
}

variable "alb_deletion_protection" {
  description = "ALB deletion protection."
  type        = bool
  default     = true
}

variable "alb_log_retention_days" {
  description = "Days to keep ALB access logs."
  type        = number
  default     = 365
}

variable "waf_web_acl_arn" {
  description = "Optional regional WAFv2 web ACL ARN for the ALB (Cloudflare WAF is the primary WAF)."
  type        = string
  default     = null
}

variable "user_artifacts_cors_origins" {
  description = "Browser origins allowed to use presigned URLs on the user-artifacts bucket."
  type        = list(string)
  default     = []
}

# ------------------------------------------------------------ web / admin --

variable "enable_web" {
  description = "Run the Next.js web app on ECS behind the ALB (deploy target undecided: Vercel vs ECS)."
  type        = bool
  default     = false
}

variable "web_hostname" {
  description = "Hostname for the web app (required when enable_web = true)."
  type        = string
  default     = null

  validation {
    condition     = !var.enable_web || var.web_hostname != null
    error_message = "web_hostname is required when enable_web = true."
  }
}

variable "enable_admin" {
  description = "Run the Next.js admin app on ECS. Never exposed publicly: requires admin_allowed_cidrs (and Cloudflare Access/WAF in front)."
  type        = bool
  default     = false
}

variable "admin_hostname" {
  description = "Hostname for the admin app (required when enable_admin = true)."
  type        = string
  default     = null

  validation {
    condition     = !var.enable_admin || var.admin_hostname != null
    error_message = "admin_hostname is required when enable_admin = true."
  }
}

variable "admin_allowed_cidrs" {
  description = "Source CIDRs (office/VPN egress) allowed to reach the admin app via an ALB source-ip condition. Max 4. Required when enable_admin = true."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.admin_allowed_cidrs) <= 4 && alltrue([for c in var.admin_allowed_cidrs : can(cidrhost(c, 0)) && c != "0.0.0.0/0"])
    error_message = "admin_allowed_cidrs: at most 4 valid CIDRs, and never 0.0.0.0/0."
  }

  validation {
    condition     = !var.enable_admin || length(var.admin_allowed_cidrs) > 0
    error_message = "enable_admin = true requires a non-empty admin_allowed_cidrs. The admin app must never be public."
  }
}

# ---------------------------------------------------------------- compute --

variable "image_tags" {
  description = "Immutable image tag (e.g. git SHA) per service. Must include every enabled service."
  type        = map(string)

  validation {
    condition     = alltrue([for s in ["api", "ai-service", "temporal-worker", "provider-worker", "voice-agent"] : contains(keys(var.image_tags), s)])
    error_message = "image_tags must contain api, ai-service, temporal-worker, provider-worker and voice-agent (plus web/admin when enabled)."
  }

  validation {
    condition     = alltrue([for t in values(var.image_tags) : t != "latest" && can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", t))])
    error_message = "image tags must be valid, immutable tags (not latest)."
  }
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture (X86_64 or ARM64/Graviton). Images must be built for it."
  type        = string
  default     = "X86_64"
}

variable "service_sizing" {
  description = "Per-service Fargate size and autoscaling bounds."
  type = map(object({
    cpu          = number
    memory       = number
    min_capacity = number
    max_capacity = number
  }))
  default = {
    api               = { cpu = 1024, memory = 2048, min_capacity = 3, max_capacity = 12 }
    "ai-service"      = { cpu = 2048, memory = 4096, min_capacity = 3, max_capacity = 12 }
    "temporal-worker" = { cpu = 1024, memory = 2048, min_capacity = 2, max_capacity = 8 }
    "provider-worker" = { cpu = 512, memory = 1024, min_capacity = 2, max_capacity = 6 }
    "voice-agent"     = { cpu = 2048, memory = 4096, min_capacity = 2, max_capacity = 10 }
    web               = { cpu = 512, memory = 1024, min_capacity = 2, max_capacity = 6 }
    admin             = { cpu = 256, memory = 512, min_capacity = 1, max_capacity = 2 }
  }

  validation {
    condition     = alltrue([for s in values(var.service_sizing) : s.min_capacity <= s.max_capacity && s.min_capacity >= 0])
    error_message = "min_capacity must be >= 0 and <= max_capacity."
  }
}

variable "container_insights" {
  description = "ECS Container Insights mode (enhanced, enabled, disabled)."
  type        = string
  default     = "enhanced"
}

variable "enable_execute_command" {
  description = "Enable ECS Exec on all services (break-glass only; grants ssmmessages to task roles)."
  type        = bool
  default     = false
}

variable "livekit_url" {
  description = "LiveKit Cloud project URL (wss://...). Not secret."
  type        = string
  default     = null
}

variable "otel_exporter_otlp_endpoint" {
  description = "OTLP endpoint for traces/metrics (optional)."
  type        = string
  default     = null
}

# ------------------------------------------------------------- PostgreSQL --

variable "rds_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.m7g.large"
}

variable "rds_multi_az" {
  description = "RDS Multi-AZ standby."
  type        = bool
  default     = true
}

variable "rds_allocated_storage_gib" {
  description = "Initial RDS storage (GiB)."
  type        = number
  default     = 100
}

variable "rds_max_allocated_storage_gib" {
  description = "RDS storage autoscaling ceiling (GiB)."
  type        = number
  default     = 1000
}

variable "rds_backup_retention_days" {
  description = "Automated backup / PITR retention (days)."
  type        = number
  default     = 30
}

variable "rds_deletion_protection" {
  description = "RDS deletion protection (also controls final snapshot on destroy)."
  type        = bool
  default     = true
}

variable "rds_performance_insights_enabled" {
  description = "Enable Performance Insights. Unsupported on some small burstable classes - verify for the chosen class."
  type        = bool
  default     = true
}

variable "rds_monitoring_interval" {
  description = "Enhanced Monitoring interval (0 disables)."
  type        = number
  default     = 60
}

variable "rds_connections_alarm_threshold" {
  description = "Alarm threshold for DatabaseConnections (~80% of max_connections for the class)."
  type        = number
  default     = 500
}

# ------------------------------------------------------------------ cache --

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.m7g.large"
}

variable "redis_num_cache_clusters" {
  description = "ElastiCache node count (primary + replicas)."
  type        = number
  default     = 2
}

variable "redis_multi_az" {
  description = "ElastiCache Multi-AZ with automatic failover."
  type        = bool
  default     = true
}

variable "redis_auth_token_version" {
  description = "Bump to rotate the ElastiCache AUTH token (value never stored in state)."
  type        = number
  default     = 1
}

# -------------------------------------------------- retention & lifecycle --

variable "log_retention_days" {
  description = "CloudWatch log retention for services, flow logs, RDS and cache logs."
  type        = number
  default     = 90
}

variable "event_archive_retention_days" {
  description = "EventBridge archive retention (days)."
  type        = number
  default     = 90
}

variable "secret_recovery_window_days" {
  description = "Secrets Manager recovery window (7-30)."
  type        = number
  default     = 30
}

variable "kms_deletion_window_days" {
  description = "KMS key deletion waiting period (7-30)."
  type        = number
  default     = 30
}

# ------------------------------------------------------------- monitoring --

variable "alert_email_addresses" {
  description = "Emails subscribed to the alerts SNS topic."
  type        = list(string)
  default     = []
}

variable "budget_monthly_limit_usd" {
  description = "Monthly cost budget (USD) for resources tagged Environment=<environment>. null disables."
  type        = number
  default     = null
}

variable "api_trusted_proxy_hops" {
  description = "Reverse-proxy hops in front of the api whose X-Forwarded-For entries are trusted for client IPs (rate limiting). 2 = Cloudflare -> ALB (the supported topology), 1 = ALB only. Too high lets clients spoof their IP; too low collapses all clients onto proxy IPs."
  type        = number
  default     = 2

  validation {
    condition     = var.api_trusted_proxy_hops >= 1 && var.api_trusted_proxy_hops <= 3
    error_message = "api_trusted_proxy_hops must be between 1 and 3."
  }
}

# ------------------------------------------------------------- Identity --

variable "oidc" {
  description = <<-EOT
    End-user identity provider for the API (ADR-0015: Amazon Cognito user pool).
    Cognito: issuer_url = https://cognito-idp.<region>.amazonaws.com/<pool-id>,
    jwks_url = <issuer_url>/.well-known/jwks.json, audience = <app client id>,
    audience_claim = "client_id", required_token_use = "access". Not secret.
    Left null, the API refuses to start (fail closed) — it never falls back to dev auth.
  EOT
  type = object({
    issuer_url         = optional(string)
    jwks_url           = optional(string)
    audience           = optional(string)
    audience_claim     = optional(string, "client_id")
    required_token_use = optional(string, "access")
    allowed_algorithms = optional(list(string), ["RS256"])
  })
  default = {}

  validation {
    condition     = contains(["aud", "client_id"], var.oidc.audience_claim)
    error_message = "oidc.audience_claim must be \"aud\" or \"client_id\"."
  }
  validation {
    condition     = var.oidc.audience_claim != "client_id" || var.oidc.required_token_use == "access"
    error_message = "client_id audience validation requires required_token_use = \"access\"."
  }
  validation {
    condition     = var.oidc.issuer_url == null || startswith(coalesce(var.oidc.issuer_url, "x"), "https://")
    error_message = "oidc.issuer_url must be an https URL."
  }
}
