import type { AccountDraft } from "@postplan/api";
import type { Command } from "commander";
import { createApiClient } from "../api.js";
import { pluralize, timeAgo } from "../format.js";
import { readAuth } from "../state.js";
import { apiUrlOption, type ApiUrlOptions } from "./options.js";

interface ListOptions extends ApiUrlOptions {
  json?: boolean;
}

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List the drafts published to your account.")
    .addOption(apiUrlOption())
    .option("--json", "Print the raw JSON response")
    .action(async (options: ListOptions) => {
      const { drafts } = await createApiClient(readAuth(options.apiUrl)).drafts.list();

      if (options.json) {
        console.log(JSON.stringify(drafts, null, 2));
        return;
      }

      if (!drafts.length) {
        console.log("No drafts yet. Publish one with: postplan upload <file>");
        return;
      }

      console.log(`Drafts (${drafts.length})\n`);
      for (const draft of drafts) {
        console.log(formatDraft(draft));
      }
    });
}

function formatDraft(draft: AccountDraft): string {
  const repo = draft.repoOrg && draft.repoName ? `${draft.repoOrg}/${draft.repoName}` : "no repo";
  const version = draft.latestVersionNumber ? `v${draft.latestVersionNumber}` : "no versions";
  const summary = [
    repo,
    version,
    pluralize(draft.versionCount, "version"),
    `updated ${timeAgo(draft.updatedAt)}`,
    ...(draft.disabled ? ["disabled"] : []),
  ].join(" · ");

  return [
    draft.title || "Untitled Draft",
    `  ${summary}`,
    `  ${draft.publicUrl}`,
    ...(draft.description ? [`  ${draft.description}`] : []),
    "",
  ].join("\n");
}
