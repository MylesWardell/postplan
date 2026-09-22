# Configuration and authentication

## Required variables

- `AWS_S3_BUCKET_NAME`
- `AWS_DEFAULT_REGION`

## Optional variables

| Variable                                                     | Purpose                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `DATABASE_PATH`                                              | SQLite file. Defaults to `data/postplan.sqlite`; use an absolute path in production. |
| `POSTPLAN_BOOTSTRAP_API_KEY`                                 | Creates or updates the bootstrap administrator key on startup.                       |
| `AWS_ENDPOINT_URL`                                           | Selects S3-compatible storage instead of native AWS S3.                              |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                 | Static storage credentials. Omit on EC2 when using an instance role.                 |
| `AWS_S3_FORCE_PATH_STYLE`                                    | Defaults to true for custom endpoints and false for native S3.                       |
| `POSTPLAN_PUBLIC_BASE_URL`                                   | Public base URL, including wildcard forms such as `https://*.postplan.dev`.          |
| `POSTPLAN_SESSION_SECRET`                                    | Enables web sign-in with `POSTPLAN_PUBLIC_BASE_URL`.                                 |
| `POSTPLAN_ALLOWED_LOGIN_EMAILS`                              | Comma-separated exact verified email addresses.                                      |
| `POSTPLAN_BLOCKED_LOGIN_EMAILS`                              | Comma-separated exact verified email addresses that must be denied.                  |
| `POSTPLAN_ALLOWED_LOGIN_DOMAINS`                             | Comma-separated verified email domains, such as `example.com,test.dev`.              |
| `SHOO_BASE_URL`                                              | Shoo identity broker. Defaults to `https://shoo.dev`.                                |
| `TRUST_PROXY`, `CLIENT_IP_SOURCE`, `REQUEST_ID_HEADER`       | Trusted proxy topology and audit headers.                                            |
| `MAX_HTML_BYTES`                                             | Maximum accepted HTML size.                                                          |
| `UPLOAD_IP_RATE_LIMIT_WINDOW_MS`, `UPLOAD_IP_RATE_LIMIT_MAX` | Anonymous upload limit.                                                              |
| `UPLOAD_RATE_LIMIT_WINDOW_MS`, `UPLOAD_RATE_LIMIT_MAX`       | Authenticated upload limit.                                                          |

Uploads are public by default. Set `POSTPLAN_ALLOW_ANONYMOUS_UPLOADS=false` to require an API key for uploads; the AWS deployment and example environment use this private-team setting. API keys control administrative endpoints and attach uploads to an account.

## DynamoDB and Lambda

Set `POSTPLAN_IDENTITY_TABLE`, `POSTPLAN_PLANS_TABLE`, `POSTPLAN_RECORDS_TABLE`, and `POSTPLAN_RATE_LIMITS_TABLE` together to select DynamoDB. `PLAN_RETENTION_DAYS` defaults to 90 days since the last successful upload; 0 disables automatic expiry. SQLite ignores this retention policy. DynamoDB bootstrap seeding is an explicit command, not a cold-start action. See [database configuration and migration limits](../apps/web/DATABASE.md).

Lambda supplies `AWS_REGION` and temporary credentials, including `AWS_SESSION_TOKEN`. Set `POSTPLAN_SESSION_SECRET_PARAMETER_ARN` and optionally `POSTPLAN_BOOTSTRAP_SECRET_PARAMETER_ARN` to load SSM SecureStrings before startup. `POSTPLAN_API_GATEWAY=true` selects trusted API Gateway request-context handling and is only suitable behind the Lambda Web Adapter. The [Terraform runbook](../infra/terraform/README.md) configures these settings, images, and the cleanup schedule.

## Dashboard-managed Cloudflare settings

Store personal login allow/block lists as Worker **Secrets** under **Settings → Variables and Secrets**, not in checked-in Wrangler vars. The production config requires `POSTPLAN_ALLOWED_LOGIN_EMAILS` and `POSTPLAN_PUBLIC_BASE_URL` there alongside the signing secrets. See [Cloudflare setup](../packages/cloudflare/README.md#deployment).

## Web sign-in

Set `POSTPLAN_SESSION_SECRET` and `POSTPLAN_PUBLIC_BASE_URL` to enable `/dashboard` and `/cli/auth`. If either value is missing, those routes return 503 without affecting uploads or public drafts.

Shoo handles sign-in. Postplan uses PKCE S256, verifies Shoo's ES256 identity token against its JWKS, and stores the stable `pairwise_sub` claim. Postplan then issues its own 30-day HMAC-signed session cookie. Dashboard routes only run on the apex application host; draft subdomains cannot serve them.

The sign-in flow requests Shoo's `pii` consent for email, name, and profile picture. Postplan replaces those profile values after each login, while retaining the stable PII subject identifier. Declining consent denies sign-in.

Login access rules are comma-separated and case-insensitive. `POSTPLAN_ALLOWED_LOGIN_EMAILS` allows exact addresses, while `POSTPLAN_ALLOWED_LOGIN_DOMAINS` allows every address in an exact domain; if both are set, matching either allowlist permits sign-in. `POSTPLAN_BLOCKED_LOGIN_EMAILS` always wins over both allowlists. A blocklist by itself permits every other verified address. If any access rule is set, a syntactically valid verified email is required. With all three variables empty, Shoo login remains unrestricted.

Draft ownership comes from the API key or browser session used to upload it. Anonymous uploads remain public but do not belong to an account. Git and CI provenance sent by the CLI is display and audit data, not authorization data.

## Proxy settings

Behind one trusted proxy, use `TRUST_PROXY=1`, `CLIENT_IP_SOURCE=req-ip`, and the proxy's request ID header. Direct local connections should use `TRUST_PROXY=false` and `CLIENT_IP_SOURCE=req-ip`. Preserve the request Host and Origin, overwrite forwarded headers at the proxy, and do not log cookies or authorization headers.
