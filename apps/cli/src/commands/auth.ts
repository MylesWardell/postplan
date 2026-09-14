import { once } from "node:events";
import readline from "node:readline/promises";
import type { Command } from "commander";
import { createApiClient } from "../api";
import { CliError } from "../errors";
import { readAuth, saveCredentials } from "../state";
import { apiUrlOption, type ApiUrlOptions } from "./options";

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Manage CLI authentication.");

  auth
    .command("set")
    .description("Save an API key without verifying it.")
    .argument("<api-key>", "Postplan API key")
    .addOption(apiUrlOption())
    .action((apiKey: string, options: ApiUrlOptions) => {
      saveCredentials(apiKey, options.apiUrl);
      console.log("Postplan credentials saved.");
    });

  auth
    .command("login")
    .description("Log in by pasting an API key from the browser. Works over SSH.")
    .addOption(apiUrlOption())
    .action(async (options: ApiUrlOptions) => {
      const { apiUrl } = readAuth(options.apiUrl, { requireApiKey: false });

      console.log("Open this in your browser (any device):\n");
      console.log(`  ${apiUrl}/cli/auth\n`);
      console.log("Sign in, generate a key, then paste it below.\n");

      const apiKey = await promptApiKey();
      if (!apiKey) {
        throw new CliError("No key entered. Nothing saved.");
      }

      const account = await createApiClient({ apiUrl, apiKey }).account.me();

      saveCredentials(apiKey, options.apiUrl);
      console.log(`\nLogged in as ${account.accountName} (key: ${account.apiKeyName}).`);
    });
}

async function promptApiKey(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // rl.question never resolves if stdin closes (EOF/ctrl-d) — race the close
    // event so that path resolves to an empty key instead of exiting 0 silently.
    const answer = await Promise.race([
      rl.question("Paste your API key: "),
      once(rl, "close").then(() => ""),
    ]);
    return answer.trim();
  } finally {
    rl.close();
  }
}
