resource "random_password" "origin" {
  count   = var.cloudfront == null ? 0 : 1
  length  = 48
  special = false
}
data "archive_file" "authorizer" {
  count       = var.cloudfront == null ? 0 : 1
  type        = "zip"
  source_file = "${path.module}/edge-authorizer.cjs"
  output_path = "${path.module}/.terraform/edge-authorizer.zip"
}
resource "aws_iam_role" "authorizer" {
  count = var.cloudfront == null ? 0 : 1
  name  = "${var.name}-edge-authorizer"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_lambda_function" "authorizer" {
  count            = var.cloudfront == null ? 0 : 1
  function_name    = "${var.name}-edge-authorizer"
  role             = aws_iam_role.authorizer[0].arn
  runtime          = "nodejs24.x"
  handler          = "edge-authorizer.handler"
  filename         = data.archive_file.authorizer[0].output_path
  source_code_hash = data.archive_file.authorizer[0].output_base64sha256
  timeout          = 5
  environment {
    variables = { ORIGIN_SECRET = random_password.origin[0].result }
  }
}
resource "aws_apigatewayv2_authorizer" "edge" {
  count                             = var.cloudfront == null ? 0 : 1
  api_id                            = aws_apigatewayv2_api.app.id
  name                              = "cloudfront-only"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.authorizer[0].invoke_arn
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  authorizer_result_ttl_in_seconds  = 0
  identity_sources                  = ["$request.header.x-postplan-origin"]
}
resource "aws_lambda_permission" "authorizer" {
  count          = var.cloudfront == null ? 0 : 1
  statement_id   = "ApiGatewayAuthorizer"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.authorizer[0].function_name
  principal      = "apigateway.amazonaws.com"
  source_arn     = "${aws_apigatewayv2_api.app.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.edge[0].id}"
  source_account = var.account_id
}
resource "aws_cloudfront_function" "vpn" {
  count   = var.cloudfront == null ? 0 : 1
  name    = "${var.name}-vpn"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = templatefile("${path.module}/vpn.js.tftpl", { cidrs = jsonencode(sort(tolist(var.cloudfront.vpn_ipv4_cidrs))) })
}
resource "aws_cloudfront_distribution" "app" {
  count           = var.cloudfront == null ? 0 : 1
  enabled         = true
  is_ipv6_enabled = false
  aliases         = sort(tolist(local.domains))
  web_acl_id      = var.cloudfront.web_acl_arn
  comment         = "${var.name} VPN-only application and plans"
  origin {
    domain_name = aws_apigatewayv2_domain_name.app[var.domain_name].domain_name_configuration[0].target_domain_name
    origin_id   = "api"
    custom_header {
      name  = "x-postplan-origin"
      value = random_password.origin[0].result
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    target_origin_id       = "api"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    # Managed CachingDisabled and AllViewer; preserve the viewer Host and auth.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.vpn[0].arn
    }
  }
  viewer_certificate {
    acm_certificate_arn      = var.cloudfront.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  depends_on = [aws_lambda_permission.authorizer]
}
