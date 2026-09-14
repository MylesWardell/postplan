import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export async function loadRuntimeSecrets() {
  const references = [
    ["POSTPLAN_SESSION_SECRET_PARAMETER_ARN", "POSTPLAN_SESSION_SECRET"],
    ["POSTPLAN_BOOTSTRAP_SECRET_PARAMETER_ARN", "POSTPLAN_BOOTSTRAP_API_KEY"],
  ] as const;
  const selected = references.filter(([reference]) => process.env[reference]);
  if (!selected.length) {
    return;
  }
  const client = new SSMClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  });
  try {
    for (const [reference, destination] of selected) {
      const parameter = await client.send(
        new GetParameterCommand({ Name: process.env[reference], WithDecryption: true }),
      );
      if (parameter.Parameter?.Type !== "SecureString" || !parameter.Parameter.Value) {
        throw new Error(`Expected a nonempty SecureString for ${reference}`);
      }
      process.env[destination] = parameter.Parameter.Value;
    }
  } finally {
    client.destroy();
  }
}
