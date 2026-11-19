locals {
  identifier = "${var.name_prefix}-postgres"
}

resource "aws_db_subnet_group" "this" {
  name       = local.identifier
  subnet_ids = var.subnet_ids
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${local.identifier}-pg17-"
  family      = "postgres17"
  description = "KAREN PostgreSQL 17 parameters"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # pg_stat_statements for query analysis. pgvector does NOT need preloading:
  # it is enabled per database with `CREATE EXTENSION vector` in migrations.
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = tostring(var.log_min_duration_statement_ms)
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Pre-create the export log group so it gets retention + KMS (RDS would
# otherwise create it unencrypted with infinite retention).
resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${local.identifier}/postgresql"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
}

data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0

  name               = "${local.identifier}-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
}

data "aws_partition" "current" {}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0

  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  identifier     = local.identifier
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = var.db_name
  username = var.master_username
  port     = 5432

  manage_master_user_password   = true
  master_user_secret_kms_key_id = var.secrets_kms_key_arn

  iam_database_authentication_enabled = true

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.data_kms_key_arn

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  publicly_accessible    = false
  network_type           = "IPV4"
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  parameter_group_name = aws_db_parameter_group.this.name

  backup_retention_period  = var.backup_retention_period
  backup_window            = var.backup_window
  maintenance_window       = var.maintenance_window
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${local.identifier}-final"

  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false

  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_kms_key_id       = var.performance_insights_enabled ? var.data_kms_key_arn : null
  performance_insights_retention_period = var.performance_insights_enabled ? var.performance_insights_retention_period : null

  monitoring_interval = var.monitoring_interval
  monitoring_role_arn = var.monitoring_interval > 0 ? aws_iam_role.monitoring[0].arn : null

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  depends_on = [aws_cloudwatch_log_group.postgresql]
}
