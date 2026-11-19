resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = var.container_insights
  }
}

# Private DNS namespace for internal service discovery, e.g.
# http://ai-service.<name_prefix>.internal:8100 (resolvable only inside the VPC).
resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = "${var.name_prefix}.internal"
  description = "Internal service discovery for ${var.name_prefix}"
  vpc         = var.vpc_id
}
