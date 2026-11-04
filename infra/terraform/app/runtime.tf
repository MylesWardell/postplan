resource "aws_cloudwatch_log_group" "function" {
  for_each          = local.function_names
  name              = "/aws/lambda/${each.value}"
  retention_in_days = var.log_retention_days
}
resource "aws_lambda_function" "function" {
  for_each                       = local.function_names
  function_name                  = each.value
  role                           = aws_iam_role.function[each.key].arn
  package_type                   = "Image"
  image_uri                      = var.image_uris[each.key]
  architectures                  = ["x86_64"]
  memory_size                    = each.key == "app" ? var.app_memory_mb : 256
  timeout                        = each.key == "app" ? 25 : 300
  reserved_concurrent_executions = each.key == "app" ? var.app_concurrency : 1
  publish                        = true
  environment {
    variables = merge(local.environment, each.key == "app" ? {
      PORT                                  = "3000"
      AWS_LWA_PORT                          = "3000"
      AWS_LWA_READINESS_CHECK_PATH          = "/healthz"
      AWS_LWA_INVOKE_MODE                   = "buffered"
      POSTPLAN_PUBLIC_BASE_URL              = "https://${var.wildcard_enabled ? "*." : ""}${var.domain_name}"
      POSTPLAN_ALLOWED_LOGIN_DOMAINS        = join(",", sort(tolist(var.allowed_login_domains)))
      POSTPLAN_API_GATEWAY                  = "true"
      POSTPLAN_SESSION_SECRET_PARAMETER_ARN = var.session_secret_parameter_arn
      } : {
      CLEANUP_METRIC_NAMESPACE = "Postplan/${var.name}"
      }, each.key == "app" && var.bootstrap_secret_parameter_arn != null ? {
      POSTPLAN_BOOTSTRAP_SECRET_PARAMETER_ARN = var.bootstrap_secret_parameter_arn
    } : {}, each.key == "app" ? local.datadog_environment : {})
  }
  depends_on = [aws_iam_role_policy.function, aws_cloudwatch_log_group.function]
}
resource "aws_lambda_alias" "live" {
  for_each         = local.function_names
  name             = "live"
  function_name    = aws_lambda_function.function[each.key].function_name
  function_version = aws_lambda_function.function[each.key].version
}
resource "aws_sqs_queue" "failures" {
  name                      = "${var.name}-cleanup-failures"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
resource "aws_lambda_function_event_invoke_config" "cleanup" {
  function_name                = aws_lambda_function.function["cleanup"].function_name
  qualifier                    = aws_lambda_alias.live["cleanup"].name
  maximum_event_age_in_seconds = 3600
  maximum_retry_attempts       = 2
  destination_config {
    on_failure { destination = aws_sqs_queue.failures.arn }
  }
}
resource "aws_scheduler_schedule" "cleanup" {
  name                         = "${var.name}-cleanup"
  state                        = var.cleanup_enabled ? "ENABLED" : "DISABLED"
  schedule_expression          = var.cleanup_schedule
  schedule_expression_timezone = "UTC"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_alias.live["cleanup"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ source = "scheduled-retention" })
    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 2
    }
    dead_letter_config { arn = aws_sqs_queue.failures.arn }
  }
  depends_on = [aws_iam_role_policy.scheduler, aws_lambda_function_event_invoke_config.cleanup]
}
locals {
  # The Datadog Lambda Extension receives OTLP spans locally and forwards traces,
  # enhanced invocation metrics and function logs to Datadog.
  datadog_service = var.datadog == null ? null : coalesce(var.datadog.service, var.name)
  datadog_environment = var.datadog == null ? {} : merge({
    DD_SITE                                         = var.datadog.site
    DD_ENV                                          = var.datadog.environment
    DD_SERVICE                                      = local.datadog_service
    DD_SERVERLESS_LOGS_ENABLED                      = "true"
    DD_ENHANCED_METRICS                             = "true"
    DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT = "localhost:4318"
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT              = "http://localhost:4318/v1/traces"
    OTEL_SERVICE_NAME                               = local.datadog_service
    }, { for k, v in {
      DD_API_KEY_SSM_ARN    = var.datadog.api_key_parameter_arn
      DD_API_KEY_SECRET_ARN = var.datadog.api_key_secret_arn
      DD_VERSION            = var.datadog.version
  } : k => v if v != null })
}
