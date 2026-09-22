import type { Command } from "commander";

import { DRAFT_PAGE_SIZE_MAX, type AccountDraft } from "@postplan/api";

import { createApiClient } from "../api";
import { pluralize, timeAgo } from "../format";
import { readAuth } from "../state";
import { apiUrlOption, type ApiUrlOptions } from "./options";

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
      const client = createApiClient(readAuth(options.apiUrl));
      const drafts: AccountDraft[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.drafts.list({ limit: DRAFT_PAGE_SIZE_MAX, cursor });
        drafts.push(...page.drafts);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

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
