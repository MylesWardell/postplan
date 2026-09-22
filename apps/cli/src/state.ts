import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ApiConnection } from "./api";
import { CliError } from "./errors";

interface CliConfig {
  apiUrl?: string;
}

interface Credentials {
  apiKey?: string;
  updatedAt?: string;
}

export interface DraftMapping {
  draftId: string;
  publicUrl: string;
  rawUrl: string;
  latestVersionNumber: number;
  updatedAt: string;
}

interface DraftsFile {
  files?: Record<string, DraftMapping>;
}

const DEFAULT_API_URL = "https://postplan.dev";
const POSTPLAN_DIR = path.join(os.homedir(), ".postplan");
const CONFIG_PATH = path.join(POSTPLAN_DIR, "config.json");
const CREDENTIALS_PATH = path.join(POSTPLAN_DIR, "credentials.json");
const DRAFTS_PATH = path.join(POSTPLAN_DIR, "drafts.json");

/**
 * Resolves the API URL and key from flags, environment and saved state, in that order.
 */
export function readAuth(
  apiUrlOverride?: string,
  { requireApiKey = true }: { requireApiKey?: boolean } = {},
): ApiConnection {
  const config = readJson<CliConfig>(CONFIG_PATH, {});
  const credentials = readJson<Credentials>(CREDENTIALS_PATH, {});
  const apiUrl = trimTrailingSlashes(
    apiUrlOverride || process.env.POSTPLAN_API_URL || config.apiUrl || DEFAULT_API_URL,
  );
  const apiKey = process.env.POSTPLAN_API_KEY || credentials.apiKey;

  if (requireApiKey && !apiKey) {
    throw new CliError("Missing API key. Run: postplan auth set <api-key>");
  }

  return { apiUrl, apiKey };
}

export function saveCredentials(apiKey: string, apiUrlOverride: string | undefined): void {
  if (apiUrlOverride) {
    writeJson(CONFIG_PATH, {
      ...readJson<CliConfig>(CONFIG_PATH, {}),
      apiUrl: trimTrailingSlashes(apiUrlOverride),
    });
  }

  writeJson(CREDENTIALS_PATH, { apiKey, updatedAt: new Date().toISOString() });
}

export function findDraft(file: string): DraftMapping | undefined {
  return readDrafts().files?.[file];
}

export function saveDraft(file: string, mapping: DraftMapping): void {
  const drafts = readDrafts();
  writeJson(DRAFTS_PATH, { ...drafts, files: { ...drafts.files, [file]: mapping } });
}

function readDrafts(): DraftsFile {
  return readJson<DraftsFile>(DRAFTS_PATH, { files: {} });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown, mode = 0o600): void {
  fs.mkdirSync(POSTPLAN_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.chmodSync(file, mode);
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}
