terraform {
  # >= 1.11: the redis module uses ephemeral resources and write-only
  # arguments so the ElastiCache AUTH token never enters state.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = length(var.allowed_account_ids) > 0 ? var.allowed_account_ids : null

  default_tags {
    tags = {
      Project            = "karen"
      Environment        = var.environment
      ManagedBy          = "terraform"
      DataClassification = "internal" # Overridden per resource where data is more sensitive.
    }
  }
}
