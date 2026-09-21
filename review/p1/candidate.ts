// JS glue for the html5ever WASM candidate. Mirrors validateHtml's JS-only
// steps (input checks, title trim/slice, externalHost, dedup, warnings).
import { readFileSync } from "node:fs";
import type { HtmlValidationOptions, HtmlValidationResult } from "../../packages/store/src/html-policy";

const wasmPath = new URL(`./${process.env.POLICY_WASM ?? "policy-wasm"}/target/wasm32-unknown-unknown/release/policy_wasm.wasm`, import.meta.url);
const module = new WebAssembly.Module(readFileSync(wasmPath));

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  validate(ptr: number, len: number, dsd: number): number;
}

let exports: Exports = instantiate();
function instantiate(): Exports {
  return new WebAssembly.Instance(module, {}).exports as unknown as Exports;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function validateHtmlWasm(
  html: unknown,
  options: HtmlValidationOptions & { dsd?: boolean; walkTemplates?: boolean } = {},
): HtmlValidationResult {
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty = { hasInlineScript: false, externalImageHosts: [] };

  if (typeof html !== "string" || html.trim() === "") {
    errors.push("HTML document is empty.");
    return { ok: false, errors, warnings, title: null, hasScripts: false, stats: empty };
  }
  const byteLength = Buffer.byteLength(html, "utf8");
  if (byteLength > maxBytes) {
    errors.push(`HTML document is ${byteLength} bytes; maximum is ${maxBytes} bytes.`);
    return { ok: false, errors, warnings, title: null, hasScripts: false, stats: empty };
  }

  const capacity = html.length * 3;
  let out: number;
  let ptr = 0;
  try {
    ptr = exports.alloc(capacity);
    const { written } = encoder.encodeInto(html, new Uint8Array(exports.memory.buffer, ptr, capacity));
    out = exports.validate(ptr, written, (options.dsd ? 1 : 0) | (options.walkTemplates ? 2 : 0));
    exports.dealloc(ptr, capacity);
  } catch {
    exports = instantiate();
    errors.push("HTML document could not be parsed.");
    return { ok: false, errors, warnings, title: null, hasScripts: false, stats: empty };
  }

  const bytes = new Uint8Array(exports.memory.buffer);
  const view = new DataView(exports.memory.buffer);
  const end = out + 4 + view.getUint32(out, true);
  let title: string | null = null;
  let hasScripts = false;
  const hosts = new Set<string>();
  for (let at = out + 4; at < end; ) {
    const tag = bytes[at]!;
    const len = view.getUint32(at + 1, true);
    const text = len ? decoder.decode(bytes.subarray(at + 5, at + 5 + len)) : "";
    at += 5 + len;
    if (tag === 69) errors.push(text);
    else if (tag === 84) title = text.trim().slice(0, 140) || null;
    else if (tag === 73) {
      const host = externalHost(text);
      if (host) hosts.add(host);
    } else if (tag === 83) hasScripts = true;
  }

  if (!title) warnings.push("No <title> found; Postplan will use a generic title.");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    title,
    hasScripts,
    stats: { hasInlineScript: hasScripts, externalImageHosts: [...hosts].toSorted() },
  };
}

function externalHost(value: string | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") return url.hostname.toLowerCase();
  } catch {}
  return null;
}
