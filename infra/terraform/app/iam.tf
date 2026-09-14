resource "aws_iam_role" "function" {
  for_each = local.function_names
  name     = each.value
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
locals {
  secret_arns    = compact([var.session_secret_parameter_arn, var.bootstrap_secret_parameter_arn])
  app_tables     = flatten([for arn in values(local.table_arns) : [arn, "${arn}/index/*"]])
  cleanup_tables = [local.table_arns.plans, local.table_arns.records]
}
resource "aws_iam_role_policy" "function" {
  for_each = local.function_names
  role     = aws_iam_role.function[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect   = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.function[each.key].arn}:*"]
      },
      {
        Effect   = "Allow"
        Action   = each.key == "app" ? ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem", "dynamodb:ConditionCheckItem"] : ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem", "dynamodb:PutItem"]
        Resource = each.key == "app" ? local.app_tables : local.cleanup_tables
      },
      {
        Effect   = "Allow"
        Action   = each.key == "app" ? ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"] : ["s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = ["${aws_s3_bucket.html.arn}/drafts/*"]
      }
      ], jsondecode(each.key == "app" ? jsonencode(concat([
        { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = local.secret_arns }
        ], var.secret_kms_key_arn == null ? [] : [{
          Effect    = "Allow", Action = ["kms:Decrypt"], Resource = [var.secret_kms_key_arn]
          Condition = { StringEquals = { "kms:ViaService" = "ssm.${var.region}.amazonaws.com" } }
        }])) : jsonencode([
        {
          Effect    = "Allow", Action = ["s3:ListBucket", "s3:ListBucketVersions"], Resource = [aws_s3_bucket.html.arn]
          Condition = { StringLike = { "s3:prefix" = ["drafts/", "drafts/*"] } }
        },
        { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = [aws_sqs_queue.failures.arn] },
        {
          Effect    = "Allow", Action = ["cloudwatch:PutMetricData"], Resource = ["*"]
          Condition = { StringEquals = { "cloudwatch:namespace" = "Postplan/${var.name}" } }
        }
    ])))
  })
}
resource "aws_iam_role" "scheduler" {
  name = "${var.name}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.account_id }, ArnEquals = { "aws:SourceArn" = "${local.prefix}:scheduler:${var.region}:${var.account_id}:schedule-group/default" } }
    }]
  })
}
resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = [aws_lambda_alias.live["cleanup"].arn] },
      { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = [aws_sqs_queue.failures.arn] }
    ]
  })
}
