# KAREN environment composition.
#
# This file is intentionally IDENTICAL across environments/{dev,staging,production};
# per-environment differences live only in variables.tf defaults and tfvars.
# Keep them in sync (`diff environments/dev/main.tf environments/production/main.tf`).

data "aws_caller_identity" "current" {}

locals {
  name_prefix   = "karen-${var.environment}"
  secret_prefix = "karen/${var.environment}"
  account_id    = data.aws_caller_identity.current.account_id

  backend_services = ["api", "ai-service", "temporal-worker", "provider-worker", "voice-agent"]
  frontend_services = concat(
    var.enable_web ? ["web"] : [],
    var.enable_admin ? ["admin"] : [],
  )
  services = toset(concat(local.backend_services, local.frontend_services))

  # Container ports (null = no listening port).
  ports = {
    api               = 4100
    "ai-service"      = 8100
    "temporal-worker" = null
    "provider-worker" = 4200
    "voice-agent"     = 8200 # health endpoint only; no inbound rule
    web               = 3000
    admin             = 3000
  }

  # Container health checks avoid curl/wget so distroless-ish images work:
  # Node services use the built-in fetch; Python services use urllib.
  node_health   = "node -e \"fetch('http://127.0.0.1:%d%s').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""
  python_health = "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%d%s', timeout=3).status==200 else 1)\""

  health_checks = {
    api               = format(local.node_health, 4100, "/health/ready")
    "ai-service"      = format(local.python_health, 8100, "/health/ready")
    "temporal-worker" = null
    "provider-worker" = format(local.node_health, 4200, "/health/ready")
    "voice-agent"     = format(local.python_health, 8200, "/health/ready")
    web               = format(local.node_health, 3000, "/")
    admin             = format(local.node_health, 3000, "/")
  }

  # ------------------------------------------------------------- secrets --
  # Containers only; values are set out-of-band (see docs/runbooks).
  secret_definitions = {
    "shared/INTERNAL_SERVICE_HMAC_SECRET" = { description = "HMAC key for signed service-to-service requests" }
    "shared/LOG_PSEUDONYMIZATION_KEY"     = { description = "Key for pseudonymising identifiers in logs" }
    "shared/SENTRY_DSN"                   = { description = "Sentry DSN for backend services" }
    "shared/TEMPORAL_ADDRESS"             = { description = "Temporal Cloud gRPC endpoint (host:port)" }
    "shared/TEMPORAL_NAMESPACE"           = { description = "Temporal Cloud namespace" }
    "shared/TEMPORAL_API_KEY"             = { description = "Temporal Cloud API key" }
    "shared/LIVEKIT_API_KEY"              = { description = "LiveKit Cloud API key" }
    "shared/LIVEKIT_API_SECRET"           = { description = "LiveKit Cloud API secret" }
    "ai-service/AI_GATEWAY_API_KEY"       = { description = "Vercel AI Gateway key - ai-service ONLY, never in clients" }
    "ai-service/LANGFUSE_PUBLIC_KEY"      = { description = "Langfuse public key" }
    "ai-service/LANGFUSE_SECRET_KEY"      = { description = "Langfuse secret key" }
    "provider-worker/PROVIDER_WEBHOOK_SECRETS" = {
      description = "JSON map of provider -> webhook signing secret"
    }
    # Only the API has PostgreSQL access (least privilege; infra/database/roles.sql). This is the
    # NON-OWNER runtime role (karen_api_runtime member); the migration role's URL is held by
    # operators and never injected into a service.
    "api/DATABASE_URL" = { description = "Postgres URL for the api DB role (sslmode=verify-full)" }
  }

  s = module.secrets.secret_arns

  common_secrets = {
    INTERNAL_SERVICE_HMAC_SECRET = local.s["shared/INTERNAL_SERVICE_HMAC_SECRET"]
    LOG_PSEUDONYMIZATION_KEY     = local.s["shared/LOG_PSEUDONYMIZATION_KEY"]
    SENTRY_DSN                   = local.s["shared/SENTRY_DSN"]
  }
  temporal_secrets = {
    TEMPORAL_ADDRESS   = local.s["shared/TEMPORAL_ADDRESS"]
    TEMPORAL_NAMESPACE = local.s["shared/TEMPORAL_NAMESPACE"]
    TEMPORAL_API_KEY   = local.s["shared/TEMPORAL_API_KEY"]
  }
  livekit_secrets = {
    LIVEKIT_API_KEY    = local.s["shared/LIVEKIT_API_KEY"]
    LIVEKIT_API_SECRET = local.s["shared/LIVEKIT_API_SECRET"]
  }
  redis_secret = { REDIS_AUTH_TOKEN = module.redis.auth_token_secret_arn }

  service_secrets = {
    api = merge(local.common_secrets, local.temporal_secrets, local.livekit_secrets, local.redis_secret, {
      DATABASE_URL = local.s["api/DATABASE_URL"]
    })
    "ai-service" = merge(local.common_secrets, local.redis_secret, {
      AI_GATEWAY_API_KEY  = local.s["ai-service/AI_GATEWAY_API_KEY"]
      LANGFUSE_PUBLIC_KEY = local.s["ai-service/LANGFUSE_PUBLIC_KEY"]
      LANGFUSE_SECRET_KEY = local.s["ai-service/LANGFUSE_SECRET_KEY"]
    })
    "temporal-worker" = merge(local.common_secrets, local.temporal_secrets, local.redis_secret, {
    })
    "provider-worker" = merge(local.common_secrets, local.temporal_secrets, local.redis_secret, {
      PROVIDER_WEBHOOK_SECRETS = local.s["provider-worker/PROVIDER_WEBHOOK_SECRETS"]
    })
    "voice-agent" = merge(local.common_secrets, local.livekit_secrets)
    web           = { SENTRY_DSN = local.s["shared/SENTRY_DSN"] }
    admin         = { SENTRY_DSN = local.s["shared/SENTRY_DSN"] }
  }

  # ---------------------------------------------------- plain environment --
  redis_env = {
    REDIS_HOST = module.redis.primary_endpoint_address
    REDIS_PORT = tostring(module.redis.port)
    REDIS_TLS  = "true"
  }
  ai_service_url = "http://ai-service.${module.ecs_cluster.service_discovery_namespace_name}:8100"

  base_env = merge(
    {
      APP_ENV    = var.environment
      LOG_LEVEL  = var.app_log_level
      AWS_REGION = var.aws_region
    },
    var.otel_exporter_otlp_endpoint == null ? {} : { OTEL_EXPORTER_OTLP_ENDPOINT = var.otel_exporter_otlp_endpoint },
  )
  livekit_env = var.livekit_url == null ? {} : { LIVEKIT_URL = var.livekit_url }

  service_env = {
    api = merge(local.base_env, local.redis_env, local.livekit_env, {
      PORT                   = "4100"
      API_TRUSTED_PROXY_HOPS = tostring(var.api_trusted_proxy_hops)
      # Real IdP only (ADR-0015). Unset OIDC values make the API refuse to start: fail closed.
      AUTH_MODE               = "oidc"
      OIDC_ISSUER_URL         = var.oidc.issuer_url == null ? "" : var.oidc.issuer_url
      OIDC_JWKS_URL           = var.oidc.jwks_url == null ? "" : var.oidc.jwks_url
      OIDC_AUDIENCE           = var.oidc.audience == null ? "" : var.oidc.audience
      OIDC_AUDIENCE_CLAIM     = var.oidc.audience_claim
      OIDC_REQUIRED_TOKEN_USE = var.oidc.required_token_use == null ? "" : var.oidc.required_token_use
      OIDC_ALLOWED_ALGORITHMS = join(",", var.oidc.allowed_algorithms)
      AI_SERVICE_URL          = local.ai_service_url
      TEMPORAL_TLS_ENABLED    = "true"
      EVENT_BUS_NAME          = module.eventbridge.bus_name
      USER_ARTIFACTS_BUCKET   = module.s3_user_artifacts.bucket_name
      EVIDENCE_BUCKET         = module.s3_evidence.bucket_name
    })
    "ai-service" = merge(local.base_env, local.redis_env, {
      PORT                  = "8100"
      KAREN_AI_BUDGET_STORE = "redis" # shared, atomic daily AI budget across replicas (ADR-0013)
      USER_ARTIFACTS_BUCKET = module.s3_user_artifacts.bucket_name
    })
    "temporal-worker" = merge(local.base_env, local.redis_env, {
      TEMPORAL_TLS_ENABLED      = "true"
      EVENT_BUS_NAME            = module.eventbridge.bus_name
      TASK_EVENTS_QUEUE_URL     = module.sqs_task_events.queue_url
      PROVIDER_EVENTS_QUEUE_URL = module.sqs_provider_events.queue_url
      USER_ARTIFACTS_BUCKET     = module.s3_user_artifacts.bucket_name
      EVIDENCE_BUCKET           = module.s3_evidence.bucket_name
    })
    "provider-worker" = merge(local.base_env, local.redis_env, {
      PORT                      = "4200"
      TEMPORAL_TLS_ENABLED      = "true"
      PROVIDER_EVENTS_QUEUE_URL = module.sqs_provider_events.queue_url
      EVIDENCE_BUCKET           = module.s3_evidence.bucket_name
    })
    "voice-agent" = merge(local.base_env, local.livekit_env, {
      HEALTH_PORT    = "8200"
      AI_SERVICE_URL = local.ai_service_url
    })
    web   = merge(local.base_env, { PORT = "3000", NEXT_PUBLIC_API_BASE_URL = "https://${var.api_hostname}" })
    admin = merge(local.base_env, { PORT = "3000", NEXT_PUBLIC_API_BASE_URL = "https://${var.api_hostname}" })
  }

  # ------------------------------------------------- IAM data permissions --
  ua  = module.s3_user_artifacts.bucket_arn
  evi = module.s3_evidence.bucket_arn

  service_permissions = {
    api = {
      # Presigned upload/download URLs on user-artifacts; presigned evidence downloads.
      s3_read_bucket_arns  = [local.ua, local.evi]
      s3_write_bucket_arns = [local.ua]
      event_bus_arns       = [module.eventbridge.bus_arn]
    }
    "ai-service" = {
      s3_read_bucket_arns = [local.ua]
    }
    "temporal-worker" = {
      s3_read_bucket_arns  = [local.ua, local.evi]
      s3_write_bucket_arns = [local.evi]
      sqs_consume_arns     = [module.sqs_task_events.queue_arn, module.sqs_provider_events.queue_arn]
      event_bus_arns       = [module.eventbridge.bus_arn]
    }
    "provider-worker" = {
      s3_read_bucket_arns  = [local.evi]
      s3_write_bucket_arns = [local.evi]
      sqs_send_arns        = [module.sqs_provider_events.queue_arn]
    }
    "voice-agent" = {}
    web           = {}
    admin         = {}
  }

  security_group_keys = {
    api               = "api"
    "ai-service"      = "ai_service"
    "temporal-worker" = "temporal_worker"
    "provider-worker" = "provider_worker"
    "voice-agent"     = "voice_agent"
    web               = "web"
    admin             = "admin"
  }

  # ------------------------------------------------------- ALB routing --
  alb_targets = merge(
    {
      api = {
        port              = 4100
        health_check_path = "/health/ready"
        priority          = 100
        host_headers      = [var.api_hostname]
      }
      # Provider webhooks: separate rule, evaluated before the api catch-all.
      "provider-worker" = {
        port              = 4200
        health_check_path = "/health/ready"
        priority          = 10
        host_headers      = [coalesce(var.webhooks_hostname, var.api_hostname)]
        path_patterns     = ["/webhooks/*"]
      }
    },
    var.enable_web ? {
      web = {
        port              = 3000
        health_check_path = "/"
        priority          = 200
        host_headers      = [var.web_hostname]
      }
    } : {},
    var.enable_admin ? {
      admin = {
        port              = 3000
        health_check_path = "/"
        priority          = 300
        host_headers      = [var.admin_hostname]
        source_ips        = var.admin_allowed_cidrs
      }
    } : {},
  )
}

# -------------------------------------------------------------- foundation --

module "kms" {
  source = "../../modules/kms"

  name_prefix             = local.name_prefix
  deletion_window_in_days = var.kms_deletion_window_days
}

module "networking" {
  source = "../../modules/networking"

  name_prefix                = local.name_prefix
  vpc_cidr                   = var.vpc_cidr
  az_count                   = var.az_count
  single_nat_gateway         = var.single_nat_gateway
  enable_interface_endpoints = var.enable_interface_endpoints
  flow_logs_retention_days   = var.log_retention_days
  logs_kms_key_arn           = module.kms.logs_key_arn
}

module "security_groups" {
  source = "../../modules/security-groups"

  name_prefix = local.name_prefix
  vpc_id      = module.networking.vpc_id
  # Admin CIDRs are added only when the admin app is enabled (DNS-only hostname
  # case; see docs/architecture/infrastructure.md "Admin exposure").
  alb_ingress_ipv4_cidrs = distinct(concat(var.alb_ingress_ipv4_cidrs, var.enable_admin ? var.admin_allowed_cidrs : []))
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix             = local.secret_prefix
  kms_key_arn             = module.kms.secrets_key_arn
  secrets                 = local.secret_definitions
  recovery_window_in_days = var.secret_recovery_window_days
}

# -------------------------------------------------------------------- data --

module "rds" {
  source = "../../modules/rds-postgres"

  name_prefix                  = local.name_prefix
  subnet_ids                   = module.networking.database_subnet_ids
  security_group_id            = module.security_groups.security_group_ids["rds"]
  instance_class               = var.rds_instance_class
  multi_az                     = var.rds_multi_az
  allocated_storage            = var.rds_allocated_storage_gib
  max_allocated_storage        = var.rds_max_allocated_storage_gib
  backup_retention_period      = var.rds_backup_retention_days
  deletion_protection          = var.rds_deletion_protection
  skip_final_snapshot          = !var.rds_deletion_protection
  performance_insights_enabled = var.rds_performance_insights_enabled
  monitoring_interval          = var.rds_monitoring_interval
  log_retention_days           = var.log_retention_days
  secrets_kms_key_arn          = module.kms.secrets_key_arn
  data_kms_key_arn             = module.kms.data_key_arn
  logs_kms_key_arn             = module.kms.logs_key_arn
}

module "redis" {
  source = "../../modules/redis"

  name_prefix                    = local.name_prefix
  node_type                      = var.redis_node_type
  num_cache_clusters             = var.redis_num_cache_clusters
  multi_az                       = var.redis_multi_az
  subnet_ids                     = module.networking.database_subnet_ids
  security_group_id              = module.security_groups.security_group_ids["redis"]
  data_kms_key_arn               = module.kms.data_key_arn
  secrets_kms_key_arn            = module.kms.secrets_key_arn
  logs_kms_key_arn               = module.kms.logs_key_arn
  log_retention_days             = var.log_retention_days
  auth_token_version             = var.redis_auth_token_version
  secret_recovery_window_in_days = var.secret_recovery_window_days
}

module "s3_user_artifacts" {
  source = "../../modules/s3"

  bucket_name                        = "${local.name_prefix}-user-artifacts-${local.account_id}"
  kms_key_arn                        = module.kms.data_key_arn
  data_classification                = "restricted"
  noncurrent_version_expiration_days = 30
  cors_allowed_origins               = var.user_artifacts_cors_origins
  access_logging                     = { target_bucket = module.s3_alb_logs.bucket_name }
}

module "s3_evidence" {
  source = "../../modules/s3"

  bucket_name                        = "${local.name_prefix}-evidence-${local.account_id}"
  kms_key_arn                        = module.kms.data_key_arn
  data_classification                = "restricted"
  noncurrent_version_expiration_days = 365
  transition_to_ia_days              = 90
  access_logging                     = { target_bucket = module.s3_alb_logs.bucket_name }
}

# Log bucket: ALB access logs plus S3 server access logs of the data buckets.
module "s3_alb_logs" {
  source = "../../modules/s3"

  bucket_name                        = "${local.name_prefix}-alb-logs-${local.account_id}"
  kms_key_arn                        = null # ALB access logs only support SSE-S3.
  data_classification                = "internal"
  enable_alb_log_delivery            = true
  enable_s3_access_log_delivery      = true
  expiration_days                    = var.alb_log_retention_days
  noncurrent_version_expiration_days = 7
}

# --------------------------------------------------------------- messaging --

module "sqs_task_events" {
  source = "../../modules/sqs"

  name                       = "${local.name_prefix}-task-events"
  kms_key_arn                = module.kms.messaging_key_arn
  visibility_timeout_seconds = 120
  eventbridge_source_arns    = [module.eventbridge.rule_arns["tasks"]]
}

module "sqs_provider_events" {
  source = "../../modules/sqs"

  name                       = "${local.name_prefix}-provider-events"
  kms_key_arn                = module.kms.messaging_key_arn
  visibility_timeout_seconds = 300
}

module "eventbridge" {
  source = "../../modules/eventbridge"

  name_prefix            = local.name_prefix
  archive_retention_days = var.event_archive_retention_days

  routes = {
    tasks = {
      sources   = ["karen.tasks"]
      queue_arn = module.sqs_task_events.queue_arn
    }
  }
}

# ----------------------------------------------------------------- compute --

module "ecr" {
  source = "../../modules/ecr"

  name_prefix  = local.name_prefix
  repositories = local.services
  kms_key_arn  = module.kms.data_key_arn
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"

  name_prefix        = local.name_prefix
  vpc_id             = module.networking.vpc_id
  container_insights = var.container_insights
}

module "alb" {
  source = "../../modules/alb"

  name_prefix         = local.name_prefix
  vpc_id              = module.networking.vpc_id
  public_subnet_ids   = module.networking.public_subnet_ids
  security_group_id   = module.security_groups.security_group_ids["alb"]
  certificate_arn     = var.acm_certificate_arn
  access_logs_bucket  = module.s3_alb_logs.bucket_name
  deletion_protection = var.alb_deletion_protection
  waf_web_acl_arn     = var.waf_web_acl_arn
  targets             = local.alb_targets
}

module "iam" {
  source = "../../modules/iam"

  name_prefix           = local.name_prefix
  secrets_kms_key_arn   = module.kms.secrets_key_arn
  data_kms_key_arn      = module.kms.data_key_arn
  messaging_kms_key_arn = module.kms.messaging_key_arn
  rds_resource_id       = module.rds.resource_id

  services = {
    for svc in local.services : svc => merge(local.service_permissions[svc], {
      ecr_repository_arn = module.ecr.repository_arns[svc]
      log_group_arn      = module.monitoring.log_group_arns[svc]
      secret_arns        = distinct(values(local.service_secrets[svc]))
      enable_execute_cmd = var.enable_execute_command
    })
  }
}

module "service" {
  source   = "../../modules/ecs-service"
  for_each = local.services

  name             = each.value
  name_prefix      = local.name_prefix
  cluster_arn      = module.ecs_cluster.cluster_arn
  cluster_name     = module.ecs_cluster.cluster_name
  image            = "${module.ecr.repository_urls[each.value]}:${var.image_tags[each.value]}"
  cpu_architecture = var.cpu_architecture

  cpu           = var.service_sizing[each.value].cpu
  memory        = var.service_sizing[each.value].memory
  desired_count = var.service_sizing[each.value].min_capacity
  min_capacity  = var.service_sizing[each.value].min_capacity
  max_capacity  = var.service_sizing[each.value].max_capacity

  container_port       = local.ports[each.value]
  health_check_command = local.health_checks[each.value]
  environment          = local.service_env[each.value]
  secrets              = local.service_secrets[each.value]

  execution_role_arn = module.iam.execution_role_arns[each.value]
  task_role_arn      = module.iam.task_role_arns[each.value]
  log_group_name     = module.monitoring.log_group_names[each.value]

  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.security_groups.security_group_ids[local.security_group_keys[each.value]]]

  target_group_arn               = lookup(module.alb.target_group_arns, each.value, null)
  enable_service_discovery       = each.value == "ai-service"
  service_discovery_namespace_id = module.ecs_cluster.service_discovery_namespace_id
  enable_execute_command         = var.enable_execute_command
  stop_timeout                   = contains(["temporal-worker", "provider-worker", "voice-agent"], each.value) ? 120 : 30
}

# -------------------------------------------------------------- monitoring --

module "monitoring" {
  source = "../../modules/monitoring"

  name_prefix               = local.name_prefix
  logs_kms_key_arn          = module.kms.logs_key_arn
  messaging_kms_key_arn     = module.kms.messaging_key_arn
  log_retention_days        = var.log_retention_days
  service_names             = local.services
  ecs_cluster_name          = module.ecs_cluster.cluster_name
  alb_arn_suffix            = module.alb.alb_arn_suffix
  target_group_arn_suffixes = module.alb.target_group_arn_suffixes
  rds_identifier            = module.rds.identifier
  rds_allocated_storage_gib = var.rds_allocated_storage_gib
  rds_connections_threshold = var.rds_connections_alarm_threshold
  alert_email_addresses     = var.alert_email_addresses
  budget_monthly_limit_usd  = var.budget_monthly_limit_usd
  budget_environment_tag    = var.environment

  dlq_names = {
    task-events     = module.sqs_task_events.dlq_name
    provider-events = module.sqs_provider_events.dlq_name
  }
  eventbridge_rule_names = module.eventbridge.rule_names
}
