output "execution_role_arns" {
  description = "Map of service to task execution role ARN."
  value       = { for k, r in aws_iam_role.execution : k => r.arn }
}

output "task_role_arns" {
  description = "Map of service to task role ARN."
  value       = { for k, r in aws_iam_role.task : k => r.arn }
}
