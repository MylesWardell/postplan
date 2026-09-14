import { oc } from "@orpc/contract";
import { z } from "zod";
import { apiKeySummary, createdApiKey } from "@postplan/api";
import { apiKeyAuth, identityInput, identityAccount } from "./models";

export const accountStoreContract = {
  seed: oc.input(z.object({ bootstrapKey: z.string().optional() })).output(z.void()),
  findApiKey: oc.input(z.object({ token: z.string() })).output(apiKeyAuth.nullable()),
  createApiKey: oc
    .input(z.object({ accountId: z.string(), name: z.string() }))
    .output(createdApiKey),
  revokeApiKey: oc.input(z.object({ accountId: z.string(), id: z.string() })).output(z.boolean()),
  listApiKeys: oc.input(z.object({ accountId: z.string() })).output(z.array(apiKeySummary)),
  findOrCreateIdentity: oc.input(identityInput).output(identityAccount),
};
