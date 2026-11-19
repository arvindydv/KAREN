# Offline plan test: mocked AWS provider, no credentials, no API calls.
# Run: terraform init -backend=false && terraform test
# Proves the configuration evaluates (variables, validations, for_each,
# cross-module wiring); it does NOT prove the plan would succeed against AWS.

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111111111111"
      arn        = "arn:aws:iam::111111111111:user/mock"
    }
  }

  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }

  mock_data "aws_region" {
    defaults = { region = "ap-south-1", name = "ap-south-1" }
  }

  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"] }
  }

  mock_data "aws_elb_service_account" {
    defaults = { arn = "arn:aws:iam::222222222222:root" }
  }

  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }

  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:ap-south-1:111111111111:key/00000000-0000-0000-0000-000000000000" }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:rds-mock", kms_key_id = "k", secret_status = "active" }]
    }
  }
}

# The random provider is NOT mocked: it needs no credentials, and mock
# providers cannot mock ephemeral resources (used for the Redis AUTH token).

variables {
  acm_certificate_arn    = "arn:aws:acm:ap-south-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  api_hostname           = "api.production.example.com"
  alb_ingress_ipv4_cidrs = ["173.245.48.0/20", "103.21.244.0/22"]
  image_tags = {
    api               = "abc1234"
    "ai-service"      = "abc1234"
    "temporal-worker" = "abc1234"
    "provider-worker" = "abc1234"
    "voice-agent"     = "abc1234"
    web               = "abc1234"
    admin             = "abc1234"
  }
}

run "default_plan" {
  command = plan

  assert {
    condition     = length(module.service) == 5
    error_message = "Expected the five backend services when web/admin are disabled."
  }

  assert {
    condition     = !contains(keys(module.alb.target_group_arns), "admin")
    error_message = "Admin must not be routed by default."
  }
}

run "with_web_and_admin" {
  command = plan

  variables {
    enable_web          = true
    web_hostname        = "app.production.example.com"
    enable_admin        = true
    admin_hostname      = "admin.production.example.com"
    admin_allowed_cidrs = ["198.51.100.0/24"]
  }

  assert {
    condition     = length(module.service) == 7
    error_message = "Expected seven services with web and admin enabled."
  }
}

run "admin_without_allowlist_is_rejected" {
  command = plan

  variables {
    enable_admin   = true
    admin_hostname = "admin.production.example.com"
  }

  expect_failures = [var.admin_allowed_cidrs]
}

run "latest_tag_is_rejected" {
  command = plan

  variables {
    image_tags = {
      api               = "latest"
      "ai-service"      = "abc1234"
      "temporal-worker" = "abc1234"
      "provider-worker" = "abc1234"
      "voice-agent"     = "abc1234"
    }
  }

  expect_failures = [var.image_tags]
}
