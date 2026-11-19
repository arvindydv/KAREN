# S3 backend with PARTIAL configuration: bucket, key, region and KMS key are
# supplied at init time so no account-specific names are committed:
#
#   terraform init -backend-config=backend.hcl
#
# See backend.hcl.example and docs/runbooks/terraform-state-bootstrap.md.
terraform {
  backend "s3" {
    encrypt      = true
    use_lockfile = true # S3-native state locking (no DynamoDB table).
  }
}
