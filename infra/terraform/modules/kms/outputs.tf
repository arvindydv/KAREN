output "secrets_key_arn" {
  description = "ARN of the CMK used for Secrets Manager."
  value       = aws_kms_key.this["secrets"].arn
}

output "data_key_arn" {
  description = "ARN of the CMK used for data at rest (RDS, ElastiCache, S3, ECR)."
  value       = aws_kms_key.this["data"].arn
}

output "logs_key_arn" {
  description = "ARN of the CMK used for CloudWatch Logs."
  value       = aws_kms_key.this["logs"].arn
}

output "messaging_key_arn" {
  description = "ARN of the CMK used for SQS and SNS."
  value       = aws_kms_key.this["messaging"].arn
}
