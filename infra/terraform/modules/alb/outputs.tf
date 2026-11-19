output "alb_arn" {
  description = "ALB ARN."
  value       = aws_lb.this.arn
}

output "alb_arn_suffix" {
  description = "ALB ARN suffix (CloudWatch dimension)."
  value       = aws_lb.this.arn_suffix
}

output "alb_dns_name" {
  description = "ALB DNS name (point Cloudflare proxied records here)."
  value       = aws_lb.this.dns_name
}

output "target_group_arns" {
  description = "Map of target key to target group ARN."
  value       = { for k, tg in aws_lb_target_group.this : k => tg.arn }
}

output "target_group_arn_suffixes" {
  description = "Map of target key to target group ARN suffix (CloudWatch dimension)."
  value       = { for k, tg in aws_lb_target_group.this : k => tg.arn_suffix }
}
