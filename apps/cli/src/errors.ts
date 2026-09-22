import { CommanderError } from "commander";

/** An expected failure whose message is shown to the user as-is. */
export class CliError extends Error {}

/** Prints a failure from command parsing or execution and returns the process exit code. */
export function reportError(error: unknown): number {
  // Commander has already written help, version or usage output itself.
  if (error instanceof CommanderError) {
    return error.exitCode;
  }

  // CliError, ORPCError and validation errors all carry a user-facing message.
  console.error(error instanceof Error ? error.message : String(error));
  return 1;
}
