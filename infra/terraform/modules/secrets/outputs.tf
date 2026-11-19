output "secret_arns" {
  description = "Map of secret id to secret ARN (ARNs are not sensitive; values are never managed here)."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}
