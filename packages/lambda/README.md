# Lambda runtime adapters

AWS gateway normalization, S3 HTML storage, Parameter Store secret loading and DynamoDB runtime configuration live here. The server supplies application settings to these adapters. The Lambda Web Adapter and Bun process entry remain the default deployment when `POSTPLAN_RUNTIME` is unset or `aws`.

Cloudflare uses its own runtime package and injects the same Store and HTML storage interfaces into the shared application.

Set `POSTPLAN_DATABASE=sqlite` for Bun SQLite or `POSTPLAN_DATABASE=dynamodb` for DynamoDB. Only the selected store is opened. Explicit selection overrides legacy detection, so SQLite also works when `AWS_LAMBDA_FUNCTION_NAME` is set. DynamoDB requires all four table names; SQLite uses `DATABASE_PATH`.

When unset, existing deployments continue selecting DynamoDB if a table variable or Lambda function name is present, and SQLite otherwise. Comma-separated/multiple database values and unknown values are rejected. Cloudflare supports only `sqlite` through its D1 driver.
