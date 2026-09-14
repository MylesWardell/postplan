export type TrustProxySetting = boolean | number | string;
export type ClientIpSource = "x-real-ip" | "req-ip";

export interface S3Config {
  endpoint: string | undefined;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  bucketName: string | undefined;
  region: string | undefined;
  forcePathStyle: boolean;
}

export interface Config {
  port: number;
  databaseUrl: string | undefined;
  // PEM bundle used to verify the Postgres server certificate (e.g. the RDS
  // global bundle). Absent, the connection string's own sslmode applies.
  databaseSslCaFile: string | undefined;
  bootstrapApiKey: string | undefined;
  publicBaseUrl: string | undefined;
  maxHtmlBytes: number;
  sessionSecret: string | undefined;
  shooBaseUrl: string;
  // Edge/proxy topology. Defaults preserve the Railway behaviour; see
  // src/client-ip.ts and docs/aws-deployment-plan.md for the AWS (ALB) values.
  trustProxy: TrustProxySetting;
  clientIpSource: ClientIpSource;
  requestIdHeader: string;
  s3: S3Config;
}

const env = process.env;
const s3Endpoint = env.AWS_ENDPOINT_URL || env.S3_ENDPOINT || undefined;

export const config: Config = {
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL,
  databaseSslCaFile: env.DATABASE_SSL_CA_FILE || undefined,
  bootstrapApiKey: env.POSTPLAN_BOOTSTRAP_API_KEY,
  publicBaseUrl: env.POSTPLAN_PUBLIC_BASE_URL,
  maxHtmlBytes: Number(env.MAX_HTML_BYTES || 512 * 1024),
  // Web sign-in (dashboard). Absent POSTPLAN_SESSION_SECRET, all web-auth
  // routes respond 503 and the API/serving paths are unaffected.
  sessionSecret: env.POSTPLAN_SESSION_SECRET,
  shooBaseUrl: (env.SHOO_BASE_URL || "https://shoo.dev").replace(/\/+$/, ""),
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  clientIpSource: parseClientIpSource(env.CLIENT_IP_SOURCE),
  requestIdHeader: (env.REQUEST_ID_HEADER || "x-railway-request-id").toLowerCase(),
  s3: {
    // Endpoint and static keys are only needed for S3-compatible stores
    // (Railway buckets, MinIO, R2). On AWS leave them unset: the SDK talks to
    // regional S3 and picks up credentials from the ECS task role.
    endpoint: s3Endpoint,
    accessKeyId: env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || undefined,
    bucketName: env.AWS_S3_BUCKET_NAME || env.S3_BUCKET_NAME || undefined,
    region: env.AWS_DEFAULT_REGION || env.AWS_REGION || (s3Endpoint ? "auto" : undefined),
    forcePathStyle: (env.AWS_S3_FORCE_PATH_STYLE || (s3Endpoint ? "true" : "false")) !== "false",
  },
};

export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Mirrors Express's own "trust proxy" forms: true/false, a hop count, or a
// comma-separated list of trusted addresses/subnets. Defaults to true, which
// is what the Railway deployment has always used.
function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const raw = (value ?? "").trim();
  if (!raw || raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

function parseClientIpSource(value: string | undefined): ClientIpSource {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw || raw === "x-real-ip") return "x-real-ip";
  if (raw === "req-ip") return "req-ip";
  throw new Error(`Invalid CLIENT_IP_SOURCE "${value}" (expected "x-real-ip" or "req-ip").`);
}
