locals {
  tables = {
    identity = { hash = "pk", range = "sk", ttl = false, durable = true, attributes = { pk = "S", sk = "S", accountId = "S", createdAt = "N" }, index = { hash = "accountId", range = "createdAt" } }
    plans    = { hash = "draftId", range = null, ttl = true, durable = true, attributes = { draftId = "S", accountId = "S", updatedAt = "N" }, index = { hash = "accountId", range = "updatedAt" } }
    records  = { hash = "draftId", range = "sk", ttl = false, durable = true, attributes = { draftId = "S", sk = "S" }, index = null }
    limits   = { hash = "pk", range = null, ttl = true, durable = false, attributes = { pk = "S" }, index = null }
  }
}
resource "aws_dynamodb_table" "data" {
  for_each                    = local.tables
  name                        = "${var.name}-${each.key}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = each.value.hash
  range_key                   = each.value.range
  deletion_protection_enabled = true
  dynamic "attribute" {
    for_each = each.value.attributes
    content {
      name = attribute.key
      type = attribute.value
    }
  }
  dynamic "global_secondary_index" {
    for_each = each.value.index == null ? [] : [each.value.index]
    content {
      name = "by-account"
      key_schema {
        attribute_name = global_secondary_index.value.hash
        key_type       = "HASH"
      }
      key_schema {
        attribute_name = global_secondary_index.value.range
        key_type       = "RANGE"
      }
      projection_type = "ALL"
    }
  }
  dynamic "ttl" {
    for_each = each.value.ttl ? [true] : []
    content {
      attribute_name = "ttlAt"
      enabled        = true
    }
  }
  point_in_time_recovery {
    enabled                 = each.value.durable
    recovery_period_in_days = each.value.durable ? 7 : null
  }
  server_side_encryption { enabled = true }
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket" "html" {
  bucket        = "${var.name}-html-${var.account_id}-${var.region}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "html" {
  bucket                  = aws_s3_bucket.html.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "html" {
  bucket = aws_s3_bucket.html.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "html" {
  bucket = aws_s3_bucket.html.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "html" {
  bucket = aws_s3_bucket.html.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_s3_bucket_policy" "html" {
  bucket = aws_s3_bucket.html.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Deny", Principal = "*", Action = "s3:*"
      Resource  = [aws_s3_bucket.html.arn, "${aws_s3_bucket.html.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}
