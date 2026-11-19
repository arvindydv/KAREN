output "security_group_ids" {
  description = "Map of workload name (alb, api, ai_service, temporal_worker, provider_worker, voice_agent, web, admin, rds, redis) to security group ID."
  value       = { for k, sg in aws_security_group.this : k => sg.id }
}
