# Least-privilege IAM for ECS services.
#
# Documented "*" resource exceptions (AWS does not support resource-level
# permissions for these actions):
#   - ecr:GetAuthorizationToken (execution roles)
#   - ssmmessages:* channel actions for ECS Exec (task roles, only when
#     enable_execute_cmd = true for that service)
# KMS statements inside key policies use "*" to mean "this key" (kms module).

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = data.aws_region.current.region
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    # Confused-deputy protection.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:ecs:${local.region}:${local.account_id}:*"]
    }
  }
}

# ------------------------------------------------------- execution roles --

resource "aws_iam_role" "execution" {
  for_each = var.services

  name               = "${var.name_prefix}-${each.key}-exec"
  description        = "ECS task execution role for ${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "execution" {
  for_each = var.services

  statement {
    sid       = "EcrAuthToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # AWS requirement: no resource-level support.
  }

  statement {
    sid       = "PullOwnImage"
    actions   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
    resources = [each.value.ecr_repository_arn]
  }

  statement {
    sid       = "DecryptOwnImageLayers"
    actions   = ["kms:Decrypt"]
    resources = [var.data_kms_key_arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ecr.${local.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${each.value.log_group_arn}:*"]
  }

  dynamic "statement" {
    for_each = length(each.value.secret_arns) > 0 ? [1] : []
    content {
      sid       = "ReadOwnSecrets"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = each.value.secret_arns
    }
  }

  dynamic "statement" {
    for_each = length(each.value.secret_arns) > 0 ? [1] : []
    content {
      sid       = "DecryptSecretsViaSecretsManager"
      actions   = ["kms:Decrypt"]
      resources = [var.secrets_kms_key_arn]

      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["secretsmanager.${local.region}.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_role_policy" "execution" {
  for_each = var.services

  name   = "execution"
  role   = aws_iam_role.execution[each.key].id
  policy = data.aws_iam_policy_document.execution[each.key].json
}

# ------------------------------------------------------------ task roles --

resource "aws_iam_role" "task" {
  for_each = var.services

  name               = "${var.name_prefix}-${each.key}-task"
  description        = "Application role for ${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  for_each = var.services

  # Application code never manages IAM. The explicit deny also keeps the
  # document non-empty for services with no AWS data-plane permissions.
  statement {
    sid       = "DenyIamIntrospection"
    effect    = "Deny"
    actions   = ["iam:*"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = length(each.value.s3_read_bucket_arns) > 0 ? [1] : []
    content {
      sid       = "ReadObjects"
      actions   = ["s3:GetObject"]
      resources = [for b in each.value.s3_read_bucket_arns : "${b}/*"]
    }
  }

  dynamic "statement" {
    for_each = length(each.value.s3_write_bucket_arns) > 0 ? [1] : []
    content {
      sid       = "WriteObjects"
      actions   = ["s3:PutObject", "s3:AbortMultipartUpload"]
      resources = [for b in each.value.s3_write_bucket_arns : "${b}/*"]
    }
  }

  dynamic "statement" {
    for_each = length(concat(each.value.s3_read_bucket_arns, each.value.s3_write_bucket_arns)) > 0 ? [1] : []
    content {
      sid       = "UseDataKeyViaS3"
      actions   = length(each.value.s3_write_bucket_arns) > 0 ? ["kms:Decrypt", "kms:GenerateDataKey"] : ["kms:Decrypt"]
      resources = [var.data_kms_key_arn]

      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["s3.${local.region}.amazonaws.com"]
      }
    }
  }

  dynamic "statement" {
    for_each = length(each.value.sqs_send_arns) > 0 ? [1] : []
    content {
      sid       = "SendToOwnQueues"
      actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
      resources = each.value.sqs_send_arns
    }
  }

  dynamic "statement" {
    for_each = length(each.value.sqs_consume_arns) > 0 ? [1] : []
    content {
      sid       = "ConsumeOwnQueues"
      actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
      resources = each.value.sqs_consume_arns
    }
  }

  dynamic "statement" {
    for_each = length(concat(each.value.sqs_send_arns, each.value.sqs_consume_arns)) > 0 ? [1] : []
    content {
      sid       = "UseMessagingKeyViaSqs"
      actions   = length(each.value.sqs_send_arns) > 0 ? ["kms:Decrypt", "kms:GenerateDataKey"] : ["kms:Decrypt"]
      resources = [var.messaging_kms_key_arn]

      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["sqs.${local.region}.amazonaws.com"]
      }
    }
  }

  dynamic "statement" {
    for_each = length(each.value.event_bus_arns) > 0 ? [1] : []
    content {
      sid       = "PublishDomainEvents"
      actions   = ["events:PutEvents"]
      resources = each.value.event_bus_arns
    }
  }

  dynamic "statement" {
    for_each = each.value.rds_iam_db_user != null && var.rds_resource_id != null ? [1] : []
    content {
      sid       = "RdsIamAuthOwnDbUser"
      actions   = ["rds-db:connect"]
      resources = ["arn:${local.partition}:rds-db:${local.region}:${local.account_id}:dbuser:${var.rds_resource_id}/${each.value.rds_iam_db_user}"]
    }
  }

  dynamic "statement" {
    for_each = each.value.enable_execute_cmd ? [1] : []
    content {
      sid = "EcsExecChannels"
      actions = [
        "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel",
      ]
      resources = ["*"] # AWS requirement: no resource-level support.
    }
  }
}

resource "aws_iam_role_policy" "task" {
  for_each = var.services

  name   = "application"
  role   = aws_iam_role.task[each.key].id
  policy = data.aws_iam_policy_document.task[each.key].json
}
