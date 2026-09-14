#!/usr/bin/env node
import { Command } from "commander";
import { registerAuthCommand } from "./commands/auth.js";
import { registerListCommand } from "./commands/list.js";
import { registerUploadCommand } from "./commands/upload.js";
import { registerWhoamiCommand } from "./commands/whoami.js";
import { reportError } from "./errors.js";
import { VERSION } from "./version.js";

const program = new Command()
  .name("postplan")
  .description("Upload static HTML drafts to Postplan.")
  .version(VERSION)
  .exitOverride();

registerAuthCommand(program);
registerWhoamiCommand(program);
registerUploadCommand(program);
registerListCommand(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.exit(reportError(error));
}
