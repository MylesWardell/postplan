#!/usr/bin/env node
import { Command } from "commander";

import { registerAuthCommand } from "./commands/auth";
import { registerListCommand } from "./commands/list";
import { registerUploadCommand } from "./commands/upload";
import { registerWhoamiCommand } from "./commands/whoami";
import { reportError } from "./errors";
import { VERSION } from "./version";

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
