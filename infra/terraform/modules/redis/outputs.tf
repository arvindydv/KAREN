output "primary_endpoint_address" {
  description = "Primary endpoint hostname (TLS required)."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  description = "Cache port."
  value       = aws_elasticache_replication_group.this.port
}

output "replication_group_id" {
  description = "Replication group ID (CloudWatch dimension prefix)."
  value       = aws_elasticache_replication_group.this.id
}

output "auth_token_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the AUTH token (value never in state)."
  value       = aws_secretsmanager_secret.auth_token.arn
}
