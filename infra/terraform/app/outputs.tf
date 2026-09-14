output "application_url" { value = "https://${var.domain_name}" }
output "health_url" { value = "https://${var.domain_name}/healthz" }
output "tables" { value = { for k, v in aws_dynamodb_table.data : k => v.name } }
output "html_bucket" { value = aws_s3_bucket.html.id }
output "certificate_validation_records" { value = local.validation_records }
output "domain_targets" {
  value = { for k, v in aws_apigatewayv2_domain_name.app : k => {
    name    = v.domain_name_configuration[0].target_domain_name
    zone_id = v.domain_name_configuration[0].hosted_zone_id
  } }
}
output "function_aliases" { value = { for k, v in aws_lambda_alias.live : k => v.arn } }
output "cleanup_failure_queue_url" { value = aws_sqs_queue.failures.url }
