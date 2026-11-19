output "bucket_name" {
  description = "Bucket name. Depends on the bucket policy so consumers (e.g. ALB access logging, which checks write permission at creation) wait for it."
  value       = aws_s3_bucket.this.id

  depends_on = [aws_s3_bucket_policy.this]
}

output "bucket_arn" {
  description = "Bucket ARN."
  value       = aws_s3_bucket.this.arn
}
