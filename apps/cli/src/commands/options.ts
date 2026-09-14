import { Option } from "commander";

export interface ApiUrlOptions {
  apiUrl?: string;
}

export function apiUrlOption(): Option {
  return new Option("--api-url <url>", "Override the default Postplan API base URL");
}
