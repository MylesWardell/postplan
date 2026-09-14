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
variable "github_repository" {
  type        = string
  description = "Exact owner/repository permitted to publish images."
}
variable "github_environment" {
  type        = string
  default     = "production"
  description = "Protect this GitHub environment before using its role."
}
variable "github_oidc_provider_arn" {
  type        = string
  default     = null
  description = "Reuse the account's GitHub OIDC provider if it exists."
}
