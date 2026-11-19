# Only non-sensitive identifiers are output. Secret ARNs are listed so
# operators know which containers to populate; values are never managed here.

output "vpc_id" {
  description = "VPC ID."
  value       = module.networking.vpc_id
}

output "alb_dns_name" {
  description = "ALB DNS name - target for the Cloudflare proxied CNAME records."
  value       = module.alb.alb_dns_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.ecs_cluster.cluster_name
}

output "ecs_service_names" {
  description = "ECS service names."
  value       = { for k, m in module.service : k => m.service_name }
}

output "ecr_repository_urls" {
  description = "ECR repository URLs (push images here, tagged with the git SHA)."
  value       = module.ecr.repository_urls
}

output "rds_endpoint" {
  description = "Private RDS endpoint hostname."
  value       = module.rds.address
}

output "rds_master_secret_arn" {
  description = "ARN of the RDS-managed master secret (migrations/break-glass only)."
  value       = module.rds.master_user_secret_arn
}

output "redis_endpoint" {
  description = "Private ElastiCache primary endpoint (TLS)."
  value       = module.redis.primary_endpoint_address
}

output "secret_arns_to_populate" {
  description = "Secret containers that an operator must populate out-of-band."
  value       = module.secrets.secret_arns
}

output "s3_buckets" {
  description = "Bucket names."
  value = {
    user_artifacts = module.s3_user_artifacts.bucket_name
    evidence       = module.s3_evidence.bucket_name
    alb_logs       = module.s3_alb_logs.bucket_name
  }
}

output "event_bus_name" {
  description = "Domain event bus name."
  value       = module.eventbridge.bus_name
}

output "queue_urls" {
  description = "SQS queue URLs."
  value = {
    task_events     = module.sqs_task_events.queue_url
    provider_events = module.sqs_provider_events.queue_url
  }
}

output "alerts_topic_arn" {
  description = "SNS topic receiving alarms."
  value       = module.monitoring.alerts_topic_arn
}

output "service_discovery_namespace" {
  description = "Private DNS namespace for internal services (e.g. ai-service.<namespace>)."
  value       = module.ecs_cluster.service_discovery_namespace_name
}
