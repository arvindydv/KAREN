# Customer managed keys, split by blast radius:
#   secrets   - Secrets Manager secret containers and the RDS-managed master secret
#   data      - RDS storage, Performance Insights, ElastiCache, S3 data buckets, ECR
#   logs      - CloudWatch Logs (service logs, VPC flow logs, RDS/ElastiCache logs)
#   messaging - SQS queues and the SNS alerts topic
# All keys have automatic annual rotation enabled.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = data.aws_region.current.region
  root_arn   = "arn:${local.partition}:iam::${local.account_id}:root"

  keys = {
    secrets   = "Secrets Manager secrets for ${var.name_prefix}"
    data      = "Data at rest (RDS, ElastiCache, S3, ECR) for ${var.name_prefix}"
    logs      = "CloudWatch Logs for ${var.name_prefix}"
    messaging = "SQS and SNS for ${var.name_prefix}"
  }
}

# Base statement shared by every key: the account root delegates key usage to
# IAM policies (standard AWS pattern; without it the key becomes unmanageable).
data "aws_iam_policy_document" "base" {
  statement {
    sid       = "EnableIAMPolicies"
    actions   = ["kms:*"]
    resources = ["*"] # In a key policy "*" means "this key".

    principals {
      type        = "AWS"
      identifiers = [local.root_arn]
    }
  }

  dynamic "statement" {
    for_each = length(var.key_administrator_arns) > 0 ? [1] : []
    content {
      sid = "AllowKeyAdministration"
      actions = [
        "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*",
        "kms:Update*", "kms:Revoke*", "kms:Disable*", "kms:Get*", "kms:Delete*",
        "kms:TagResource", "kms:UntagResource", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
        "kms:RotateKeyOnDemand",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_administrator_arns
      }
    }
  }
}

data "aws_iam_policy_document" "logs" {
  source_policy_documents = [data.aws_iam_policy_document.base.json]

  statement {
    sid       = "AllowCloudWatchLogs"
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${local.region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:*"]
    }
  }
}

data "aws_iam_policy_document" "messaging" {
  source_policy_documents = [data.aws_iam_policy_document.base.json]

  # EventBridge rules delivering to SSE-KMS SQS queues, CloudWatch alarms and
  # AWS Budgets publishing to the SSE-KMS SNS alerts topic.
  statement {
    sid       = "AllowAwsServicesToUseForMessaging"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "cloudwatch.amazonaws.com", "budgets.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

locals {
  policies = {
    secrets   = data.aws_iam_policy_document.base.json
    data      = data.aws_iam_policy_document.base.json
    logs      = data.aws_iam_policy_document.logs.json
    messaging = data.aws_iam_policy_document.messaging.json
  }
}

resource "aws_kms_key" "this" {
  for_each = local.keys

  description             = each.value
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = var.deletion_window_in_days
  policy                  = local.policies[each.key]

  tags = {
    Name    = "${var.name_prefix}-${each.key}"
    Purpose = each.key
  }
}

resource "aws_kms_alias" "this" {
  for_each = local.keys

  name          = "alias/${var.name_prefix}-${each.key}"
  target_key_id = aws_kms_key.this[each.key].key_id
}
