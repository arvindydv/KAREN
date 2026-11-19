variable "name_prefix" {
  description = "Prefix for resource names, e.g. karen-dev."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID."
  type        = string
}

variable "alb_ingress_ipv4_cidrs" {
  description = "IPv4 CIDRs allowed to reach the public ALB on 80/443. Set to Cloudflare's published ranges (https://www.cloudflare.com/ips-v4) when Cloudflare proxies the origin. Never leave empty."
  type        = list(string)

  validation {
    condition     = length(var.alb_ingress_ipv4_cidrs) > 0 && length(var.alb_ingress_ipv4_cidrs) <= 25 && alltrue([for c in var.alb_ingress_ipv4_cidrs : can(cidrhost(c, 0))])
    error_message = "alb_ingress_ipv4_cidrs must contain 1-25 valid IPv4 CIDRs."
  }
}

variable "alb_ingress_ipv6_cidrs" {
  description = "IPv6 CIDRs allowed to reach the ALB (only relevant if the ALB is dual-stack; currently IPv4-only)."
  type        = list(string)
  default     = []
}

variable "ports" {
  description = "Container ports per service."
  type = object({
    api             = number
    ai_service      = number
    provider_worker = number
    web             = number
    admin           = number
  })
  default = {
    api             = 4100
    ai_service      = 8100
    provider_worker = 4200
    web             = 3000
    admin           = 3000
  }
}

variable "temporal_cloud_port" {
  description = "TCP port for Temporal Cloud gRPC (TLS)."
  type        = number
  default     = 7233
}

variable "voice_udp_port_range" {
  description = "UDP port range the voice agent may use outbound for WebRTC media to LiveKit Cloud. Set from_port = 0 and to_port = 0 to disable UDP egress (TCP/TLS fallback only). Verify against current LiveKit Cloud firewall docs."
  type = object({
    from_port = number
    to_port   = number
  })
  default = {
    from_port = 3478
    to_port   = 65535
  }
}
