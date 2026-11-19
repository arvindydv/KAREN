variable "name" {
  description = "Service name (also used as container name), e.g. api."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.name))
    error_message = "name must be lowercase alphanumeric/hyphen, 2-31 chars."
  }
}

variable "name_prefix" {
  description = "Environment prefix, e.g. karen-dev."
  type        = string
}

variable "cluster_arn" {
  description = "ECS cluster ARN."
  type        = string
}

variable "cluster_name" {
  description = "ECS cluster name (for autoscaling resource IDs)."
  type        = string
}

variable "image" {
  description = "Full image reference (<repo-url>:<immutable-tag> or <repo-url>@sha256:<digest>). Mutable tags such as latest are rejected."
  type        = string

  validation {
    condition     = !endswith(var.image, ":latest") && (strcontains(var.image, ":") || strcontains(var.image, "@sha256:"))
    error_message = "image must be pinned to an immutable tag or digest (not :latest)."
  }
}

variable "cpu" {
  description = "Task CPU units (256, 512, 1024, 2048, 4096...)."
  type        = number
  default     = 256
}

variable "memory" {
  description = "Task memory (MiB); must be a valid Fargate pairing with cpu."
  type        = number
  default     = 512
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64 (Graviton, cheaper; images must be built for arm64)."
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "container_port" {
  description = "Container port to expose (null for workers with no listening port)."
  type        = number
  default     = null
}

variable "environment" {
  description = "Plain (non-secret) environment variables."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variable name -> Secrets Manager secret ARN (optionally with :json-key:: suffix). Injected by the ECS agent using the execution role."
  type        = map(string)
  default     = {}
}

variable "execution_role_arn" {
  description = "Task execution role ARN (pulls the image, reads this service's secrets, writes logs)."
  type        = string
}

variable "task_role_arn" {
  description = "Task role ARN (the application's own AWS permissions)."
  type        = string
}

variable "log_group_name" {
  description = "CloudWatch log group for the container's stdout/stderr."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for task ENIs."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security groups attached to the task ENIs."
  type        = list(string)
}

variable "health_check_command" {
  description = "Container health check command (CMD-SHELL form string). null disables the container health check."
  type        = string
  default     = null
}

variable "health_check_start_period" {
  description = "Seconds of grace before container health check failures count."
  type        = number
  default     = 60
}

variable "readonly_root_filesystem" {
  description = "Mount the root filesystem read-only. A writable ephemeral volume is mounted at /tmp."
  type        = bool
  default     = true
}

variable "run_as_user" {
  description = "UID[:GID] the container runs as. Must be non-root; the image must own any paths it writes outside /tmp."
  type        = string
  default     = "1000:1000"

  validation {
    condition     = !contains(["0", "root", "0:0"], var.run_as_user) && !startswith(var.run_as_user, "0:")
    error_message = "Containers must not run as root."
  }
}

variable "desired_count" {
  description = "Initial desired task count (autoscaling owns it afterwards)."
  type        = number
  default     = 1
}

variable "min_capacity" {
  description = "Autoscaling minimum task count."
  type        = number
  default     = 1
}

variable "max_capacity" {
  description = "Autoscaling maximum task count."
  type        = number
  default     = 2

  validation {
    condition     = var.max_capacity >= 1
    error_message = "max_capacity must be >= 1."
  }
}

variable "cpu_target_percent" {
  description = "Target average CPU utilisation for target-tracking scaling."
  type        = number
  default     = 60
}

variable "memory_target_percent" {
  description = "Target average memory utilisation for target-tracking scaling."
  type        = number
  default     = 75
}

variable "target_group_arn" {
  description = "Optional ALB target group to register tasks with."
  type        = string
  default     = null
}

variable "health_check_grace_period_seconds" {
  description = "Grace period for ALB health checks after task start (only with a target group)."
  type        = number
  default     = 60
}

variable "enable_service_discovery" {
  description = "Register the service in Cloud Map as <name>.<namespace> (A records). Requires service_discovery_namespace_id."
  type        = bool
  default     = false
}

variable "service_discovery_namespace_id" {
  description = "Cloud Map namespace ID (used when enable_service_discovery = true)."
  type        = string
  default     = null
}

variable "enable_execute_command" {
  description = "Enable ECS Exec (interactive shell). Keep false by default; enable temporarily for break-glass debugging only."
  type        = bool
  default     = false
}

variable "stop_timeout" {
  description = "Seconds to wait after SIGTERM before SIGKILL (max 120 on Fargate). Workers draining Temporal activities may need more."
  type        = number
  default     = 30
}
