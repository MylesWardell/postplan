import fs from "node:fs";
import path from "node:path";

import { isDefinedError, safe } from "@orpc/client";
import type { Command } from "commander";

import { createApiClient } from "../api";
import { CliError } from "../errors";
import { collectCiMetadata, collectGitMetadata, sha256 } from "../metadata";
import { findDraft, readAuth, saveDraft } from "../state";
import { VERSION } from "../version";
import { apiUrlOption, type ApiUrlOptions } from "./options";

interface UploadOptions extends ApiUrlOptions {
  draft?: string;
  new?: boolean;
  description?: string;
}

export function registerUploadCommand(program: Command): void {
  program
    .command("upload")
    .description("Upload or update an HTML draft.")
    .argument("<file>", "HTML file path")
    .option("--draft <draft-id>", "Update a specific draft")
    .option("--new", "Always create a new draft")
    .option("--description <text>", "Set a short description for the draft")
    .addOption(apiUrlOption())
    .action(upload);
}

async function upload(file: string, options: UploadOptions): Promise<void> {
  const resolvedFile = path.resolve(file);
  if (!fs.existsSync(resolvedFile)) {
    throw new CliError(`File does not exist: ${resolvedFile}`);
  }

  const connection = readAuth(options.apiUrl);
  const html = fs.readFileSync(resolvedFile, "utf8");
  const draftId = options.new ? undefined : options.draft || findDraft(resolvedFile)?.draftId;

  const [error, result] = await safe(
    createApiClient(connection).drafts.upload({
      html,
      filename: path.basename(resolvedFile),
      draftId,
      description: options.description,
      metadata: {
        ...collectGitMetadata(path.dirname(resolvedFile)),
        ...collectCiMetadata(),
        cliVersion: VERSION,
        fileSha256: sha256(html),
      },
    }),
  );

  if (error) {
    if (isDefinedError(error) && error.code === "UNPROCESSABLE_CONTENT") {
      const details = error.data.errors.map((message) => `- ${message}`);
      throw new CliError([error.message, ...details].join("\n"));
    }
    throw error;
  }

  const { body } = result;
  saveDraft(resolvedFile, {
    draftId: body.draftId,
    publicUrl: body.publicUrl,
    rawUrl: body.rawUrl,
    latestVersionNumber: body.versionNumber,
    updatedAt: new Date().toISOString(),
  });

  console.log(draftId ? "Updated draft" : "Uploaded draft");
  console.log(`URL: ${body.publicUrl}`);
  console.log(`Raw HTML: ${body.rawUrl}`);
  console.log(`Draft ID: ${body.draftId}`);
  console.log(`Version: ${body.versionNumber}`);
  for (const warning of body.warnings) {
    console.warn(`Warning: ${warning}`);
  }
}
