output "log_group_names" {
  description = "Map of service to log group name."
  value       = { for k, lg in aws_cloudwatch_log_group.service : k => lg.name }
}

output "log_group_arns" {
  description = "Map of service to log group ARN."
  value       = { for k, lg in aws_cloudwatch_log_group.service : k => lg.arn }
}

output "alerts_topic_arn" {
  description = "SNS alerts topic ARN."
  value       = aws_sns_topic.alerts.arn
}
