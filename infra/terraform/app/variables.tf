variable "region" {
  type    = string
  default = "ap-southeast-2"
}
variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Supply the target AWS account ID."
  }
}
variable "name" {
  type    = string
  default = "postplan"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,29}$", var.name))
    error_message = "Use 3-30 lowercase letters, numbers or hyphens."
  }
}
variable "domain_name" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", var.domain_name))
    error_message = "Supply a lowercase hostname without scheme, path or wildcard."
  }
}
variable "hosted_zone_id" {
  type        = string
  description = "Existing Route 53 zone. Null emits records for external DNS."
  default     = null
}
variable "wildcard_enabled" {
  type    = bool
  default = true
}
variable "image_uris" {
  type        = object({ app = string, cleanup = string })
  description = "Lambda-compatible images in this account/region, pinned by digest."
  validation {
    condition     = alltrue([for uri in values(var.image_uris) : can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com(\\.cn)?/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$", uri))])
    error_message = "Both images must be ECR URIs pinned to sha256 digests."
  }
  validation {
    condition     = alltrue([for uri in values(var.image_uris) : startswith(uri, "${var.account_id}.dkr.ecr.${var.region}.")])
    error_message = "Images must belong to the configured account and region."
  }
}
variable "plan_retention_days" {
  type    = number
  default = 90
  validation {
    condition     = var.plan_retention_days >= 0 && floor(var.plan_retention_days) == var.plan_retention_days && var.plan_retention_days <= 100000000
    error_message = "Retention must be a nonnegative whole number of days within safe timestamp arithmetic; 0 disables expiry."
  }
}
variable "session_secret_parameter_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:[^:]+:ssm:[^:]+:[0-9]{12}:parameter/.+", var.session_secret_parameter_arn))
    error_message = "Supply an existing SSM SecureString parameter ARN, not its secret value."
  }
}
variable "bootstrap_secret_parameter_arn" {
  type    = string
  default = null
}
variable "secret_kms_key_arn" {
  type        = string
  default     = null
  description = "Optional customer-managed key for the SSM secrets."
}
variable "allowed_login_domains" {
  type = set(string)
  validation {
    condition     = length(var.allowed_login_domains) > 0 && alltrue([for d in var.allowed_login_domains : can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", d))])
    error_message = "Specify at least one permitted lowercase email domain."
  }
}
variable "app_memory_mb" {
  type    = number
  default = 512
  validation {
    condition     = var.app_memory_mb >= 128 && var.app_memory_mb <= 10240 && floor(var.app_memory_mb) == var.app_memory_mb
    error_message = "Lambda memory must be a whole number from 128 to 10240."
  }
}
variable "app_concurrency" {
  type    = number
  default = 5
  validation {
    condition     = var.app_concurrency >= 1 && floor(var.app_concurrency) == var.app_concurrency
    error_message = "Concurrency must be a positive integer; check the account quota."
  }
}
variable "cleanup_enabled" {
  type    = bool
  default = false
}
variable "cleanup_schedule" {
  type        = string
  default     = "cron(0 17 * * ? *)"
  description = "UTC; default runs daily at 03:00 Sydney standard time."
}
variable "notification_email" {
  type = string
  validation {
    condition     = can(regex("^[^@ ]+@[^@ ]+\\.[^@ ]+$", var.notification_email))
    error_message = "Supply an email address for alarm and budget notifications."
  }
}
variable "monthly_budget_usd" {
  type    = number
  default = 5
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "Budget must be positive."
  }
}
variable "log_retention_days" {
  type    = number
  default = 14
  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90], var.log_retention_days)
    error_message = "Choose 1, 3, 5, 7, 14, 30, 60 or 90 days."
  }
}
