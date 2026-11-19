output "vpc_id" {
  description = "VPC ID."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC IPv4 CIDR."
  value       = aws_vpc.this.cidr_block
}

output "availability_zones" {
  description = "AZs in use."
  value       = local.azs
}

output "public_subnet_ids" {
  description = "Public subnet IDs (ALB, NAT gateways)."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (ECS tasks)."
  value       = aws_subnet.private[*].id
}

output "database_subnet_ids" {
  description = "Isolated database subnet IDs (RDS, ElastiCache). No internet route."
  value       = aws_subnet.database[*].id
}

output "nat_gateway_count" {
  description = "Number of NAT gateways created."
  value       = local.nat_count
}
