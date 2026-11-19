output "bus_name" {
  description = "Event bus name."
  value       = aws_cloudwatch_event_bus.this.name
}

output "bus_arn" {
  description = "Event bus ARN."
  value       = aws_cloudwatch_event_bus.this.arn
}

output "rule_arns" {
  description = "Map of route name to rule ARN."
  value       = { for k, r in aws_cloudwatch_event_rule.this : k => r.arn }
}

output "rule_names" {
  description = "Map of route name to rule name."
  value       = { for k, r in aws_cloudwatch_event_rule.this : k => r.name }
}
