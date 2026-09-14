export function selectDatabase(env: Record<string, string | undefined> = process.env) {
  const selected = env.POSTPLAN_DATABASE;
  if (selected !== undefined) {
    if (selected !== "sqlite" && selected !== "dynamodb") {
      throw new Error("POSTPLAN_DATABASE must be sqlite or dynamodb for AWS.");
    }
    return selected;
  }
  // Preserve existing deployments until they opt into explicit selection.
  return env.AWS_LAMBDA_FUNCTION_NAME ||
    [
      env.POSTPLAN_IDENTITY_TABLE,
      env.POSTPLAN_PLANS_TABLE,
      env.POSTPLAN_RECORDS_TABLE,
      env.POSTPLAN_RATE_LIMITS_TABLE,
    ].some(Boolean)
    ? "dynamodb"
    : "sqlite";
}
