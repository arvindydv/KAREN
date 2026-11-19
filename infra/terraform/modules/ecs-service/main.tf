data "aws_region" "current" {}

locals {
  full_name = "${var.name_prefix}-${var.name}"

  container_definition = merge(
    {
      name      = var.name
      image     = var.image
      essential = true
      user      = var.run_as_user

      readonlyRootFilesystem = var.readonly_root_filesystem
      stopTimeout            = var.stop_timeout

      environment = [for k in sort(keys(var.environment)) : { name = k, value = var.environment[k] }]
      secrets     = [for k in sort(keys(var.secrets)) : { name = k, valueFrom = var.secrets[k] }]

      portMappings = var.container_port == null ? [] : [{
        containerPort = var.container_port
        protocol      = "tcp"
        name          = "http"
      }]

      mountPoints = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]

      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = var.log_group_name
          awslogs-region        = data.aws_region.current.region
          awslogs-stream-prefix = var.name
          mode                  = "non-blocking"
          max-buffer-size       = "25m"
        }
      }
    },
    var.health_check_command == null ? {} : {
      healthCheck = {
        command     = ["CMD-SHELL", var.health_check_command]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = var.health_check_start_period
      }
    }
  )
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.full_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  # Fargate ephemeral storage is encrypted at rest by AWS. This volume gives
  # the read-only-root container a writable /tmp.
  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([local.container_definition])
}

resource "aws_service_discovery_service" "this" {
  count = var.enable_service_discovery ? 1 : 0

  name = var.name

  dns_config {
    namespace_id   = var.service_discovery_namespace_id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "A"
      ttl  = 10
    }
  }

  # ECS reports task health to Cloud Map (unhealthy tasks are not returned).
  health_check_custom_config {}
}

resource "aws_ecs_service" "this" {
  name                    = var.name
  cluster                 = var.cluster_arn
  task_definition         = aws_ecs_task_definition.this.arn
  desired_count           = var.desired_count
  launch_type             = "FARGATE"
  platform_version        = "LATEST"
  propagate_tags          = "SERVICE"
  enable_ecs_managed_tags = true
  enable_execute_command  = var.enable_execute_command
  wait_for_steady_state   = false

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = var.target_group_arn == null ? null : var.health_check_grace_period_seconds

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [1]
    content {
      target_group_arn = var.target_group_arn
      container_name   = var.name
      container_port   = var.container_port
    }
  }

  dynamic "service_registries" {
    for_each = var.enable_service_discovery ? [1] : []
    content {
      registry_arn = aws_service_discovery_service.this[0].arn
    }
  }

  lifecycle {
    # Autoscaling owns the running count after creation.
    ignore_changes = [desired_count]

    precondition {
      condition     = var.target_group_arn == null || var.container_port != null
      error_message = "container_port is required when target_group_arn is set."
    }
  }
}

# ------------------------------------------------------------ autoscaling --

resource "aws_appautoscaling_target" "this" {
  service_namespace  = "ecs"
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.full_name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = var.cpu_target_percent
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "memory" {
  name               = "${local.full_name}-memory"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = var.memory_target_percent
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}
