terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.64"
    }
  }
  backend "s3" {}
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags { tags = { Project = var.name, ManagedBy = "Terraform" } }
}
data "aws_partition" "current" {}
locals {
  prefix         = "arn:${data.aws_partition.current.partition}"
  table_arns     = { for key, table in aws_dynamodb_table.data : key => table.arn }
  function_names = { app = "${var.name}-app", cleanup = "${var.name}-cleanup" }
  domains        = toset(var.wildcard_enabled ? [var.domain_name, "*.${var.domain_name}"] : [var.domain_name])
  environment = {
    NODE_ENV                   = "production"
    PLAN_RETENTION_DAYS        = tostring(var.plan_retention_days)
    AWS_S3_BUCKET_NAME         = aws_s3_bucket.html.id
    POSTPLAN_IDENTITY_TABLE    = aws_dynamodb_table.data["identity"].name
    POSTPLAN_PLANS_TABLE       = aws_dynamodb_table.data["plans"].name
    POSTPLAN_RECORDS_TABLE     = aws_dynamodb_table.data["records"].name
    POSTPLAN_RATE_LIMITS_TABLE = aws_dynamodb_table.data["limits"].name
  }
}
