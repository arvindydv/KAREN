output "identifier" {
  description = "DB instance identifier (CloudWatch dimension)."
  value       = aws_db_instance.this.identifier
}

output "address" {
  description = "DB endpoint hostname (private)."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "DB port."
  value       = aws_db_instance.this.port
}

output "db_name" {
  description = "Initial database name."
  value       = aws_db_instance.this.db_name
}

output "resource_id" {
  description = "DB resource ID (used in rds-db:connect IAM ARNs)."
  value       = aws_db_instance.this.resource_id
}

output "arn" {
  description = "DB instance ARN."
  value       = aws_db_instance.this.arn
}

output "master_user_secret_arn" {
  description = "ARN of the RDS-managed master secret (for break-glass/migration bootstrap only; not granted to services)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "allocated_storage_gib" {
  description = "Allocated storage (GiB), used for the free-storage alarm threshold."
  value       = var.allocated_storage
}
