mock_provider "aws" {
  override_during = plan
  mock_resource "aws_s3_bucket" { defaults = { arn = "arn:aws:s3:::test-state", id = "test-state" } }
  mock_resource "aws_ecr_repository" { defaults = { arn = "arn:aws:ecr:ap-southeast-2:123456789012:repository/test" } }
  mock_resource "aws_iam_openid_connect_provider" { defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" } }
}
variables {
  account_id        = "123456789012"
  github_repository = "MylesWardell/postplan-clone"
}
run "restricted_publisher" {
  command = plan
  assert {
    condition     = jsondecode(aws_iam_role.publisher.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:MylesWardell/postplan-clone:environment:production"
    error_message = "OIDC trust must name the exact repo/environment."
  }
  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled" && alltrue([for r in aws_ecr_repository.image : r.image_tag_mutability == "IMMUTABLE"])
    error_message = "State must be versioned and release tags immutable."
  }
}
run "reuse_oidc" {
  command = plan
  variables { github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0
    error_message = "Do not duplicate an existing OIDC provider."
  }
}
