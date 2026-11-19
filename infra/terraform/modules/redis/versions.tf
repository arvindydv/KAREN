terraform {
  # Ephemeral resources and write-only arguments need Terraform >= 1.11.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.7"
    }
  }
}
