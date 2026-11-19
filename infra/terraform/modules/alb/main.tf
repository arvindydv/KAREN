resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [var.security_group_id]

  idle_timeout               = var.idle_timeout
  drop_invalid_header_fields = true
  desync_mitigation_mode     = "defensive"
  enable_deletion_protection = var.deletion_protection
  enable_http2               = true

  access_logs {
    bucket  = var.access_logs_bucket
    prefix  = "alb"
    enabled = true
  }
}

resource "aws_lb_target_group" "this" {
  for_each = var.targets

  name                 = substr("${var.name_prefix}-${each.key}", 0, 32)
  vpc_id               = var.vpc_id
  port                 = each.value.port
  protocol             = "HTTP"
  target_type          = "ip"
  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = each.value.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = var.ssl_policy
  certificate_arn   = var.certificate_arn

  routing_http_response_server_enabled                         = false
  routing_http_response_strict_transport_security_header_value = var.hsts_header_value
  routing_http_response_x_content_type_options_header_value    = "nosniff"

  # Unknown hosts/paths get a 404 rather than reaching any service.
  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Not Found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "this" {
  for_each = var.targets

  listener_arn = aws_lb_listener.https.arn
  priority     = each.value.priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[each.key].arn
  }

  condition {
    host_header {
      values = each.value.host_headers
    }
  }

  dynamic "condition" {
    for_each = length(each.value.path_patterns) > 0 ? [1] : []
    content {
      path_pattern {
        values = each.value.path_patterns
      }
    }
  }

  dynamic "condition" {
    for_each = length(each.value.source_ips) > 0 ? [1] : []
    content {
      source_ip {
        values = each.value.source_ips
      }
    }
  }
}

resource "aws_wafv2_web_acl_association" "this" {
  count = var.waf_web_acl_arn == null ? 0 : 1

  resource_arn = aws_lb.this.arn
  web_acl_arn  = var.waf_web_acl_arn
}
