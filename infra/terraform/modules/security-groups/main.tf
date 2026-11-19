# One security group per workload. All rules are explicit, referencing other
# security groups wherever the peer is inside the VPC. Internet egress is
# limited to TLS ports (443, plus Temporal Cloud's gRPC port and LiveKit UDP
# media where needed). Security groups cannot filter by FQDN; partner egress
# allowlisting (architecture §9) needs AWS Network Firewall or an egress proxy
# and is intentionally out of scope for this first cut.

locals {
  groups = {
    alb             = "Public ALB (ingress restricted to allowed CIDRs, e.g. Cloudflare)"
    api             = "api (NestJS) tasks"
    ai_service      = "ai-service (FastAPI) tasks - internal only"
    temporal_worker = "temporal-worker tasks - no inbound"
    provider_worker = "provider-worker tasks - webhooks via ALB"
    voice_agent     = "voice-agent (LiveKit worker) tasks - no inbound"
    web             = "web (Next.js) tasks - optional"
    admin           = "admin (Next.js) tasks - optional"
    rds             = "RDS PostgreSQL"
    redis           = "ElastiCache (Valkey/Redis)"
  }

  any_ipv4 = "0.0.0.0/0"

  # ---- SG-to-SG rules: { key = { from, to, port, desc } } -----------------
  sg_rules = {
    alb_to_api             = { from = "alb", to = "api", port = var.ports.api, desc = "ALB to api" }
    alb_to_provider_worker = { from = "alb", to = "provider_worker", port = var.ports.provider_worker, desc = "ALB to provider-worker webhooks" }
    alb_to_web             = { from = "alb", to = "web", port = var.ports.web, desc = "ALB to web" }
    alb_to_admin           = { from = "alb", to = "admin", port = var.ports.admin, desc = "ALB to admin" }

    api_to_ai_service   = { from = "api", to = "ai_service", port = var.ports.ai_service, desc = "api to ai-service" }
    voice_to_ai_service = { from = "voice_agent", to = "ai_service", port = var.ports.ai_service, desc = "voice-agent to ai-service" }

    api_to_rds             = { from = "api", to = "rds", port = 5432, desc = "api to PostgreSQL" }
    ai_service_to_rds      = { from = "ai_service", to = "rds", port = 5432, desc = "ai-service to PostgreSQL" }
    temporal_worker_to_rds = { from = "temporal_worker", to = "rds", port = 5432, desc = "temporal-worker to PostgreSQL" }
    provider_worker_to_rds = { from = "provider_worker", to = "rds", port = 5432, desc = "provider-worker to PostgreSQL" }

    api_to_redis             = { from = "api", to = "redis", port = 6379, desc = "api to Redis" }
    ai_service_to_redis      = { from = "ai_service", to = "redis", port = 6379, desc = "ai-service to Redis" }
    temporal_worker_to_redis = { from = "temporal_worker", to = "redis", port = 6379, desc = "temporal-worker to Redis" }
    provider_worker_to_redis = { from = "provider_worker", to = "redis", port = 6379, desc = "provider-worker to Redis" }
  }

  # ---- Internet egress (TCP) ----------------------------------------------
  internet_tcp_egress = {
    api_https                = { sg = "api", port = 443, desc = "HTTPS to AWS APIs / partners" }
    api_temporal             = { sg = "api", port = var.temporal_cloud_port, desc = "Temporal Cloud gRPC (start/signal workflows)" }
    ai_service_https         = { sg = "ai_service", port = 443, desc = "HTTPS to Vercel AI Gateway / Langfuse / AWS APIs" }
    temporal_worker_https    = { sg = "temporal_worker", port = 443, desc = "HTTPS to AWS APIs / partners" }
    temporal_worker_temporal = { sg = "temporal_worker", port = var.temporal_cloud_port, desc = "Temporal Cloud gRPC" }
    provider_worker_https    = { sg = "provider_worker", port = 443, desc = "HTTPS to partner APIs / AWS APIs" }
    provider_worker_temporal = { sg = "provider_worker", port = var.temporal_cloud_port, desc = "Temporal Cloud gRPC (signal workflows)" }
    voice_agent_https        = { sg = "voice_agent", port = 443, desc = "HTTPS/WSS to LiveKit Cloud and AWS APIs" }
    web_https                = { sg = "web", port = 443, desc = "HTTPS to public API and AWS APIs" }
    admin_https              = { sg = "admin", port = 443, desc = "HTTPS to public API and AWS APIs" }
  }

  alb_ingress = merge(
    { for c in var.alb_ingress_ipv4_cidrs : "v4-443-${c}" => { cidr4 = c, cidr6 = null, port = 443 } },
    { for c in var.alb_ingress_ipv4_cidrs : "v4-80-${c}" => { cidr4 = c, cidr6 = null, port = 80 } },
    { for c in var.alb_ingress_ipv6_cidrs : "v6-443-${c}" => { cidr4 = null, cidr6 = c, port = 443 } },
    { for c in var.alb_ingress_ipv6_cidrs : "v6-80-${c}" => { cidr4 = null, cidr6 = c, port = 80 } },
  )

  voice_udp_enabled = var.voice_udp_port_range.to_port > 0
}

resource "aws_security_group" "this" {
  for_each = local.groups

  name        = "${var.name_prefix}-${replace(each.key, "_", "-")}"
  description = each.value
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-${replace(each.key, "_", "-")}" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each = local.alb_ingress

  security_group_id = aws_security_group.this["alb"].id
  description       = "Allowed edge CIDR to ALB ${each.value.port}"
  cidr_ipv4         = each.value.cidr4
  cidr_ipv6         = each.value.cidr6
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "sg_to_sg" {
  for_each = local.sg_rules

  security_group_id            = aws_security_group.this[each.value.from].id
  referenced_security_group_id = aws_security_group.this[each.value.to].id
  description                  = each.value.desc
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_vpc_security_group_ingress_rule" "sg_to_sg" {
  for_each = local.sg_rules

  security_group_id            = aws_security_group.this[each.value.to].id
  referenced_security_group_id = aws_security_group.this[each.value.from].id
  description                  = each.value.desc
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "internet_tcp" {
  for_each = local.internet_tcp_egress

  security_group_id = aws_security_group.this[each.value.sg].id
  description       = each.value.desc
  cidr_ipv4         = local.any_ipv4
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "voice_udp" {
  count = local.voice_udp_enabled ? 1 : 0

  security_group_id = aws_security_group.this["voice_agent"].id
  description       = "WebRTC media (UDP) to LiveKit Cloud"
  cidr_ipv4         = local.any_ipv4
  ip_protocol       = "udp"
  from_port         = var.voice_udp_port_range.from_port
  to_port           = var.voice_udp_port_range.to_port
}
