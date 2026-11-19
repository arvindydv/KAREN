output "queue_arn" {
  description = "Main queue ARN."
  value       = aws_sqs_queue.this.arn
}

output "queue_url" {
  description = "Main queue URL."
  value       = aws_sqs_queue.this.id
}

output "queue_name" {
  description = "Main queue name."
  value       = aws_sqs_queue.this.name
}

output "dlq_arn" {
  description = "Dead-letter queue ARN."
  value       = aws_sqs_queue.dlq.arn
}

output "dlq_name" {
  description = "Dead-letter queue name (CloudWatch dimension)."
  value       = aws_sqs_queue.dlq.name
}
