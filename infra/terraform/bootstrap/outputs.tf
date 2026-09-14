output "state_bucket" { value = aws_s3_bucket.state.id }
output "image_repositories" { value = { for k, v in aws_ecr_repository.image : k => v.repository_url } }
output "image_publisher_role_arn" { value = aws_iam_role.publisher.arn }
