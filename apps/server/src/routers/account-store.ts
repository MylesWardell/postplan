import type { Store, IdentityInput } from "@postplan/store";
export type { ApiKeyAuth, IdentityInput, IdentityProfile, IdentityAccount } from "@postplan/store";
export { publicUploadAuth } from "@postplan/store";
export const seedAccounts = (store: Store, bootstrapKey?: string) =>
  store.accounts.seed({ bootstrapKey });
export const findApiKeyByToken = (store: Store, token: string) =>
  store.accounts.findApiKey({ token });
export const createApiKey = (store: Store, accountId: string, name: string) =>
  store.accounts.createApiKey({ accountId, name });
export const revokeApiKey = (store: Store, accountId: string, id: string) =>
  store.accounts.revokeApiKey({ accountId, id });
export const listAccountApiKeys = (store: Store, accountId: string) =>
  store.accounts.listApiKeys({ accountId });
export const findOrCreateAccountForIdentity = (store: Store, input: IdentityInput) =>
  store.accounts.findOrCreateIdentity(input);
