import { oc } from "@orpc/contract";
import type { RouterContractClient } from "@orpc/contract";
import { z } from "zod";

import { accountStoreContract } from "./account-store";
import { draftStoreContract } from "./draft-store";

export * from "./models";
export * from "./text";
export * from "./upload-auth";
export { accountStoreContract, draftStoreContract };
export type {
  AccountDraft,
  AccountDraftDetail,
  ApiKeySummary,
  DraftStatus,
  DraftTotals,
} from "@postplan/api";

export const storeContract = {
  accounts: accountStoreContract,
  drafts: draftStoreContract,
  initialize: oc.input(z.object({ bootstrapKey: z.string().optional() })).output(z.void()),
  health: oc.output(z.void()),
  rateLimit: oc
    .input(
      z.object({
        namespace: z.string(),
        key: z.string(),
        weight: z.number().int().positive().optional(),
        rule: z.object({
          window: z.number().int().positive(),
          maxRequests: z.number().int().positive(),
        }),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        limit: z.number(),
        remaining: z.number(),
        reset: z.number(),
      }),
    ),
};
export type Store = RouterContractClient<typeof storeContract>;
export interface StoreConnection {
  store: Store;
  close: () => void;
}
