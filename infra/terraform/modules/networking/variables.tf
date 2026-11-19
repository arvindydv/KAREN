variable "name_prefix" {
  description = "Prefix for resource names, e.g. karen-dev."
  type        = string
}

variable "vpc_cidr" {
  description = "IPv4 CIDR for the VPC. Subnets are carved automatically (private /20s, public and database /24s for a /16)."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) >= 16 && tonumber(split("/", var.vpc_cidr)[1]) <= 18
    error_message = "vpc_cidr must be a valid IPv4 CIDR with a prefix length between /16 and /18."
  }
}

variable "az_count" {
  description = "Number of Availability Zones to span. Three is the KAREN default; RDS and ElastiCache subnet groups need at least two."
  type        = number
  default     = 3

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "single_nat_gateway" {
  description = "true = one shared NAT gateway (cheap, single-AZ egress failure domain; dev). false = one NAT gateway per AZ (production)."
  type        = bool
  default     = false
}

variable "enable_interface_endpoints" {
  description = "Create interface VPC endpoints listed in interface_endpoint_services. Reduces NAT data processing and keeps AWS API traffic private, at a fixed hourly cost per endpoint per AZ."
  type        = bool
  default     = false
}

variable "interface_endpoint_services" {
  description = "Short AWS service names for interface endpoints (used when enable_interface_endpoints = true)."
  type        = list(string)
  default     = ["ecr.api", "ecr.dkr", "secretsmanager", "logs", "sqs"]

  validation {
    condition     = alltrue([for s in var.interface_endpoint_services : contains(["ecr.api", "ecr.dkr", "secretsmanager", "logs", "sqs", "events", "kms", "sts", "monitoring", "ssmmessages"], s)])
    error_message = "Unsupported interface endpoint service name."
  }
}

variable "enable_flow_logs" {
  description = "Send VPC flow logs (REJECT + ACCEPT) to an encrypted CloudWatch log group."
  type        = bool
  default     = true
}

variable "flow_logs_retention_days" {
  description = "Retention for the VPC flow log group."
  type        = number
  default     = 30
}

variable "logs_kms_key_arn" {
  description = "CMK ARN for encrypting the flow log group."
  type        = string
}
