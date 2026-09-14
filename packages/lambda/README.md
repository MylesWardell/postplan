# Lambda runtime adapters

AWS gateway normalization, S3 HTML storage, Parameter Store secret loading and DynamoDB runtime configuration live here. The server supplies application settings to these adapters. The Lambda Web Adapter and Bun process entry remain the default deployment when `POSTPLAN_RUNTIME` is unset or `aws`.

Cloudflare uses its own runtime package and injects the same Store and HTML storage interfaces into the shared application.
