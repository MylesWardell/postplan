import type { HtmlValidationOptions, HtmlValidationResult } from "@postplan/store/html-policy";

export const MAX_HTML_BYTES = 512 * 1024;
type PolicyExports = {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  validate(pointer: number, length: number, maxDepth: number): number;
};

function rejected(error: string): HtmlValidationResult {
  return {
    ok: false,
    errors: [error],
    warnings: [],
    title: null,
    hasScripts: false,
    stats: { hasInlineScript: false, externalImageHosts: [] },
  };
}

/** One synchronous instance per wrapper; never yield while its output is borrowed. */
export function createValidator(module: WebAssembly.Module) {
  let instance: PolicyExports | undefined;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function instantiate(): PolicyExports {
    const exports = new WebAssembly.Instance(module, {}).exports;
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.alloc !== "function" ||
      typeof exports.dealloc !== "function" ||
      typeof exports.validate !== "function"
    ) {
      throw new Error("Invalid HTML policy WASM exports");
    }
    // Export shapes are checked above; signatures belong to rust/abi.rs.
    return exports as PolicyExports;
  }

  return function validateHtml(
    html: unknown,
    options: HtmlValidationOptions = {},
  ): HtmlValidationResult {
    if (typeof html !== "string" || html.trim() === "") {
      return rejected("HTML document is empty.");
    }
    const maxBytes = Math.min(options.maxBytes ?? MAX_HTML_BYTES, MAX_HTML_BYTES);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError("maxBytes must be a non-negative integer");
    }
    const maxDepth = Math.min(options.maxDepth ?? 512, 512);
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
      throw new RangeError("maxDepth must be a positive integer");
    }
    const byteLength = Buffer.byteLength(html, "utf8");
    if (byteLength > maxBytes) {
      return rejected(`HTML document is ${byteLength} bytes; maximum is ${maxBytes} bytes.`);
    }
    try {
      const wasm = (instance ??= instantiate());
      const pointer = wasm.alloc(byteLength);
      let output: number;
      try {
        const { read, written } = encoder.encodeInto(
          html,
          new Uint8Array(wasm.memory.buffer, pointer, byteLength),
        );
        if (read !== html.length || written !== byteLength) {
          throw new Error("HTML UTF-8 encoding was incomplete");
        }
        output = wasm.validate(pointer, written, maxDepth);
      } finally {
        wasm.dealloc(pointer, byteLength);
      }
      const bytes = new Uint8Array(wasm.memory.buffer);
      const view = new DataView(wasm.memory.buffer);
      const end = output + 4 + view.getUint32(output, true);
      if (end > bytes.length) {
        throw new Error("Invalid WASM result length");
      }
      const errors: string[] = [];
      const hosts = new Set<string>();
      let title: string | null = null;
      let hasScripts = false;
      for (let at = output + 4; at < end;) {
        if (at + 5 > end) {
          throw new Error("Truncated WASM record");
        }
        const tag = bytes[at];
        const length = view.getUint32(at + 1, true);
        if (at + 5 + length > end) {
          throw new Error("Invalid WASM record length");
        }
        const text = decoder.decode(bytes.subarray(at + 5, at + 5 + length));
        at += 5 + length;
        switch (tag) {
          case 69:
            errors.push(text);
            break;
          case 84:
            title = text.trim().slice(0, 140) || null;
            break;
          case 83:
            hasScripts = true;
            break;
          case 73: {
            const raw = text.trim();
            try {
              const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
              if (url.protocol === "http:" || url.protocol === "https:") {
                hosts.add(url.hostname.toLowerCase());
              }
            } catch {
              /* Relative and non-URL image sources have no external host. */
            }
            break;
          }
          default:
            throw new Error("Unknown WASM record");
        }
      }
      return {
        ok: errors.length === 0,
        errors,
        warnings: title ? [] : ["No <title> found; Postplan will use a generic title."],
        title,
        hasScripts,
        stats: { hasInlineScript: hasScripts, externalImageHosts: [...hosts].toSorted() },
      };
    } catch {
      // A trapped instance may retain allocations. Discard it and fail closed.
      instance = undefined;
      return rejected("HTML document could not be parsed.");
    }
  };
}
