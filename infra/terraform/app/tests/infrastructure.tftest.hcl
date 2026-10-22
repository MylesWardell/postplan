mock_provider "aws" {
  override_during = plan
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::123456789012:role/test" } }
  mock_resource "aws_s3_bucket" { defaults = { arn = "arn:aws:s3:::test-bucket", id = "test-bucket" } }
  mock_resource "aws_dynamodb_table" { defaults = { arn = "arn:aws:dynamodb:ap-southeast-2:123456789012:table/test" } }
  mock_resource "aws_cloudwatch_log_group" { defaults = { arn = "arn:aws:logs:ap-southeast-2:123456789012:log-group:test" } }
  mock_resource "aws_lambda_function" { defaults = { arn = "arn:aws:lambda:ap-southeast-2:123456789012:function:test", version = "1" } }
  mock_resource "aws_lambda_alias" { defaults = { arn = "arn:aws:lambda:ap-southeast-2:123456789012:function:test:live", invoke_arn = "arn:aws:apigateway:ap-southeast-2:lambda:path/2015-03-31/functions/arn:aws:lambda:ap-southeast-2:123456789012:function:test:live/invocations" } }
  mock_resource "aws_sqs_queue" { defaults = { arn = "arn:aws:sqs:ap-southeast-2:123456789012:test" } }
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:ap-southeast-2:123456789012:test" } }
  mock_resource "aws_apigatewayv2_api" { defaults = { execution_arn = "arn:aws:execute-api:ap-southeast-2:123456789012:test" } }
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:ap-southeast-2:123456789012:certificate/00000000-0000-0000-0000-000000000000"
      domain_validation_options = [{
        domain_name           = "plans.example.com"
        resource_record_name  = "_test.plans.example.com"
        resource_record_type  = "CNAME"
        resource_record_value = "_test.acm-validations.aws."
      }]
    }
  }
  mock_resource "aws_acm_certificate_validation" {
    defaults = { certificate_arn = "arn:aws:acm:ap-southeast-2:123456789012:certificate/00000000-0000-0000-0000-000000000000" }
  }
}
variables {
  account_id     = "123456789012"
  domain_name    = "plans.example.com"
  hosted_zone_id = "ZTEST"
  image_uris = {
    app     = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/postplan-app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    cleanup = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/postplan-cleanup@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
  session_secret_parameter_arn = "arn:aws:ssm:ap-southeast-2:123456789012:parameter/postplan/session"
  allowed_login_domains        = ["example.com"]
  notification_email           = "dev@example.com"
}
run "safe_defaults" {
  command = plan
  assert {
    condition     = aws_scheduler_schedule.cleanup.state == "DISABLED"
    error_message = "Cleanup must not run before runtime acceptance."
  }
  assert {
    condition     = alltrue([for f in aws_lambda_function.function : f.environment[0].variables.PLAN_RETENTION_DAYS == "90"])
    error_message = "Both workers must share the default retention policy."
  }
  assert {
    condition     = length(aws_dynamodb_table.data["records"].ttl) == 0 && length(aws_dynamodb_table.data["identity"].ttl) == 0 && aws_dynamodb_table.data["plans"].ttl[0].attribute_name == "ttlAt"
    error_message = "Native TTL must not expire accounts or active version records."
  }
  assert {
    condition     = aws_apigatewayv2_api.app.disable_execute_api_endpoint && length(aws_apigatewayv2_domain_name.app) == 2 && length(aws_route53_record.validation) == 1
    error_message = "Require custom domains and deduplicate wildcard certificate validation."
  }
  assert {
    condition     = length(aws_s3_bucket_lifecycle_configuration.html.rule) == 1 && alltrue([for r in aws_s3_bucket_lifecycle_configuration.html.rule : length(r.expiration) == 0])
    error_message = "S3 age-based expiry would delete history of refreshed plans."
  }
}
run "disabled_retention_external_dns" {
  command = plan
  variables {
    plan_retention_days = 0
    hosted_zone_id      = null
    wildcard_enabled    = false
  }
  assert {
    condition     = alltrue([for f in aws_lambda_function.function : f.environment[0].variables.PLAN_RETENTION_DAYS == "0"])
    error_message = "Zero must disable policy in both workers."
  }
  assert {
    condition     = length(aws_route53_record.app) == 0 && length(aws_route53_record.validation) == 0 && length(aws_apigatewayv2_domain_name.app) == 1
    error_message = "External DNS must not create Route53 records."
  }
}
run "custom_retention" {
  command = plan
  variables {
    plan_retention_days = 365
    cleanup_enabled     = true
  }
  assert {
    condition     = alltrue([for f in aws_lambda_function.function : f.environment[0].variables.PLAN_RETENTION_DAYS == "365"]) && aws_scheduler_schedule.cleanup.state == "ENABLED"
    error_message = "Custom retention and explicit cleanup enablement must propagate."
  }
}
run "reject_negative_retention" {
  command = plan
  variables { plan_retention_days = -1 }
  expect_failures = [var.plan_retention_days]
}
run "optional_secrets" {
  command = plan
  variables {
    bootstrap_secret_parameter_arn = "arn:aws:ssm:ap-southeast-2:123456789012:parameter/postplan/bootstrap"
    secret_kms_key_arn             = "arn:aws:kms:ap-southeast-2:123456789012:key/00000000-0000-0000-0000-000000000000"
  }
  assert {
    condition     = aws_lambda_function.function["app"].environment[0].variables.POSTPLAN_BOOTSTRAP_SECRET_PARAMETER_ARN == var.bootstrap_secret_parameter_arn && !contains(keys(aws_lambda_function.function["cleanup"].environment[0].variables), "POSTPLAN_SESSION_SECRET_PARAMETER_ARN")
    error_message = "Pass secret references to the app only, never the cleanup worker."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.function["cleanup"].policy).Statement : !contains(s.Action, "ssm:GetParameter") && !contains(s.Action, "kms:Decrypt")])
    error_message = "Cleanup must not read session or bootstrap secrets."
  }
}
run "reject_fractional_retention" {
  command = plan
  variables { plan_retention_days = 0.5 }
  expect_failures = [var.plan_retention_days]
}
run "reject_mutable_images" {
  command = plan
  variables {
    image_uris = {
      app     = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/postplan-app:latest"
      cleanup = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/postplan-cleanup:latest"
    }
  }
  expect_failures = [var.image_uris]
}

run "permanent_plans" {
  command = plan
  variables {
    plan_retention_days    = 0
    max_html_bytes         = 2097152
    max_request_body_bytes = 4194304
  }
  assert {
    condition     = !aws_dynamodb_table.data["plans"].ttl[0].enabled && aws_dynamodb_table.data["limits"].ttl[0].enabled
    error_message = "Permanent plans must disable plan TTL while expiring temporary rate limits."
  }
  assert {
    condition     = aws_lambda_function.function["app"].environment[0].variables.MAX_HTML_BYTES == "2097152" && aws_lambda_function.function["app"].environment[0].variables.MAX_REQUEST_BODY_BYTES == "4194304"
    error_message = "AWS upload limits must reach the runtime."
  }
}
run "protected_ingress" {
  command = plan
  variables {
    cloudfront = {
      certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
      web_acl_arn     = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/qa/00000000-0000-0000-0000-000000000000"
      vpn_ipv4_cidrs  = ["203.0.113.10/32"]
    }
  }
  assert {
    condition     = aws_apigatewayv2_route.app.authorization_type == "CUSTOM" && aws_apigatewayv2_api.app.disable_execute_api_endpoint
    error_message = "Direct origin access must require the CloudFront secret."
  }
  assert {
    condition     = aws_cloudfront_distribution.app[0].web_acl_id == var.cloudfront.web_acl_arn && length(aws_cloudfront_distribution.app[0].aliases) == 2 && length(aws_cloudfront_distribution.app[0].default_cache_behavior[0].function_association) == 1
    error_message = "Root and wildcard must share WAF and the strict viewer VPN gate."
  }
}
