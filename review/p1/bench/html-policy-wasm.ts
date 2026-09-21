// Benchmark-only replacement for @postplan/store/html-policy: html5ever WASM
// tree construction + policy walk, same exported API as the parse5 version.
// Left external by the benchmark patch and resolved by Wrangler's CompiledWasm
// module rule, because the Cloudflare Vite plugin's own additional-module
// handling does not apply to this app's ssr environment.
// @ts-expect-error Wrangler-provided compiled WebAssembly module.
import policyModule from "./policy.wasm";

export interface HtmlStats {
  hasInlineScript: boolean;
  externalImageHosts: string[];
}

export interface HtmlValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  title: string | null;
  hasScripts: boolean;
  stats: HtmlStats;
}

export interface HtmlValidationOptions {
  maxBytes?: number;
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  validate(ptr: number, len: number, flags: number): number;
}

let exports: Exports | undefined;
const instance = () =>
  (exports ??= new WebAssembly.Instance(policyModule as WebAssembly.Module, {})
    .exports as unknown as Exports);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function validateHtml(
  html: unknown,
  options: HtmlValidationOptions = {},
): HtmlValidationResult {
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof html !== "string" || html.trim() === "") {
    errors.push("HTML document is empty.");
    return { ok: false, errors, warnings, title: null, hasScripts: false, stats: emptyStats() };
  }

  const byteLength = Buffer.byteLength(html, "utf8");
  if (byteLength > maxBytes) {
    errors.push(`HTML document is ${byteLength} bytes; maximum is ${maxBytes} bytes.`);
    return { ok: false, errors, warnings, title: null, hasScripts: false, stats: emptyStats() };
  }

  let wasm: Exports;
  let out: number;
  try {
    wasm = instance();
    const ptr = wasm.alloc(byteLength);
    const { written } = encoder.encodeInto(html, new Uint8Array(wasm.memory.buffer, ptr, byteLength));
    // flags: 1 = declarative shadow roots, 2 = walk <template> contents.
    out = wasm.validate(ptr, written, 3);
    wasm.dealloc(ptr, byteLength);
  } catch {
    exports = undefined;
    errors.push("HTML document could not be parsed.");
    return { ok: false, errors, warnings, title: null, hasScripts: false, stats: emptyStats() };
  }

  const bytes = new Uint8Array(wasm.memory.buffer);
  const view = new DataView(wasm.memory.buffer);
  const end = out + 4 + view.getUint32(out, true);
  let title: string | null = null;
  let hasScripts = false;
  const externalImageHosts = new Set<string>();
  for (let at = out + 4; at < end; ) {
    const tag = bytes[at]!;
    const len = view.getUint32(at + 1, true);
    const text = len ? decoder.decode(bytes.subarray(at + 5, at + 5 + len)) : "";
    at += 5 + len;
    if (tag === 69) {
      errors.push(text);
    } else if (tag === 84) {
      title = text.trim().slice(0, 140) || null;
    } else if (tag === 73) {
      const host = externalHost(text);
      if (host) {
        externalImageHosts.add(host);
      }
    } else if (tag === 83) {
      hasScripts = true;
    }
  }

  if (!title) {
    warnings.push("No <title> found; Postplan will use a generic title.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    title,
    hasScripts,
    stats: {
      hasInlineScript: hasScripts,
      externalImageHosts: [...externalImageHosts].toSorted(),
    },
  };
}

function emptyStats(): HtmlStats {
  return { hasInlineScript: false, externalImageHosts: [] };
}

function externalHost(value: string | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) {
    return null;
  }
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.toLowerCase();
    }
  } catch {
    // relative path, data: URI, etc.
  }
  return null;
}
