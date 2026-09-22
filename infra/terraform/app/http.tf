resource "aws_apigatewayv2_api" "app" {
  name                         = var.name
  protocol_type                = "HTTP"
  disable_execute_api_endpoint = true
}
resource "aws_apigatewayv2_integration" "app" {
  api_id                 = aws_apigatewayv2_api.app.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.live["app"].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}
resource "aws_apigatewayv2_route" "app" {
  api_id    = aws_apigatewayv2_api.app.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.app.id}"
}
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = var.log_retention_days
}
resource "aws_apigatewayv2_stage" "app" {
  api_id      = aws_apigatewayv2_api.app.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit   = 20
    throttling_rate_limit    = 10
    detailed_metrics_enabled = false
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format          = jsonencode({ requestId = "$context.requestId", status = "$context.status", responseLength = "$context.responseLength", integrationError = "$context.integrationErrorMessage" })
  }
}
resource "aws_lambda_permission" "api" {
  statement_id   = "ApiGateway"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.function["app"].function_name
  qualifier      = aws_lambda_alias.live["app"].name
  principal      = "apigateway.amazonaws.com"
  source_arn     = "${aws_apigatewayv2_api.app.execution_arn}/*/*"
  source_account = var.account_id
}
resource "aws_acm_certificate" "app" {
  domain_name               = var.domain_name
  subject_alternative_names = var.wildcard_enabled ? ["*.${var.domain_name}"] : []
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}
locals {
  # ACM uses the same validation record for the root and its wildcard.
  validation_records = {
    for domain in [var.domain_name] : domain => one([
      for dvo in aws_acm_certificate.app.domain_validation_options : {
        name  = dvo.resource_record_name
        type  = dvo.resource_record_type
        value = dvo.resource_record_value
      } if dvo.domain_name == domain
    ])
  }
}
resource "aws_route53_record" "validation" {
  for_each = var.hosted_zone_id == null ? {} : local.validation_records
  zone_id  = var.hosted_zone_id
  name     = each.value.name
  type     = each.value.type
  records  = [each.value.value]
  ttl      = 300
}
resource "aws_acm_certificate_validation" "app" {
  certificate_arn         = aws_acm_certificate.app.arn
  validation_record_fqdns = var.hosted_zone_id == null ? [for r in local.validation_records : r.name] : [for r in aws_route53_record.validation : r.fqdn]
}
resource "aws_apigatewayv2_domain_name" "app" {
  for_each    = local.domains
  domain_name = each.value
  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.app.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}
resource "aws_apigatewayv2_api_mapping" "app" {
  for_each    = local.domains
  api_id      = aws_apigatewayv2_api.app.id
  domain_name = aws_apigatewayv2_domain_name.app[each.key].id
  stage       = aws_apigatewayv2_stage.app.id
}
resource "aws_route53_record" "app" {
  for_each = var.hosted_zone_id == null ? toset([]) : local.domains
  zone_id  = var.hosted_zone_id
  name     = each.value
  type     = "A"
  alias {
    name                   = aws_apigatewayv2_domain_name.app[each.key].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.app[each.key].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
