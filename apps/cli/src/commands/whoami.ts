import type { Command } from "commander";
import { createApiClient } from "../api.js";
import { readAuth } from "../state.js";

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Check the configured Postplan credentials.")
    .action(async () => {
      const account = await createApiClient(readAuth()).account.me();
      console.log(`Account: ${account.accountName} (${account.accountId})`);
      console.log(`API key: ${account.apiKeyName} (${account.apiKeyId})`);
    });
}
