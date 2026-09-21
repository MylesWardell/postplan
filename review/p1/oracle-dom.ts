// Chrome ground truth: the production policy applied to a real browser DOM.
// Runs in the oracle page. Mirrors packages/store/src/html-policy.ts except that
// it also walks <template> contents (DOMParser leaves declarative shadow roots
// as templates, so this covers them too).
import type { PolicyOutcome } from "./oracle-shared";

const BLOCKED_TAGS = new Set(["form", "iframe", "object", "embed", "applet", "base", "link"]);
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "srcdoc", "xlink:href"]);
const BLOCKED_PROTOCOLS = ["javascript:", "vbscript:", "file:"];
const ALLOWED_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript"]);
const MAX_DEPTH = 512;
const CONTROL_OR_SPACE = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(32)}]+`, "g");

function externalHost(value: string | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.hostname.toLowerCase();
  } catch {
    // relative path, data: URI, etc.
  }
  return null;
}

function collectText(node: Node): string {
  let value = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) value += (child as Text).data;
    if (child.nodeType === Node.ELEMENT_NODE) value += collectText(child);
  }
  return value;
}

export function policyDom(root: Document, walkTemplates = true): PolicyOutcome {
  const errors: string[] = [];
  const hosts = new Set<string>();
  let title: string | null = null;
  let hasScripts = false;
  let tooDeep = false;

  const visit = (node: Element) => {
    const tagName = node.localName.toLowerCase();
    const attrs = [...node.attributes];
    if (BLOCKED_TAGS.has(tagName)) errors.push(`Blocked <${tagName}> tag found.`);

    if (tagName === "script") {
      hasScripts = true;
      const attributes = new Map(attrs.map((a) => [a.name.toLowerCase(), (a.value || "").trim()]));
      if (attributes.has("src")) errors.push("External script sources are not allowed.");
      const scriptType = (attributes.get("type") || "").toLowerCase();
      if (!ALLOWED_SCRIPT_TYPES.has(scriptType)) errors.push(`Unsupported script type "${scriptType}" found.`);
    }

    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const value = (attr.value || "").trim();
      if (name.startsWith("on")) errors.push(`Blocked inline event handler attribute "${name}" found.`);
      if (name === "srcdoc") errors.push('Blocked "srcdoc" attribute found.');
      if (URL_ATTRS.has(name)) {
        // oxlint-disable-next-line no-control-regex
        const normalized = value.replace(CONTROL_OR_SPACE, "").toLowerCase();
        if (BLOCKED_PROTOCOLS.some((p) => normalized.startsWith(p))) {
          errors.push(`Blocked unsafe URL in "${name}" attribute.`);
        }
      }
      if (name === "style" && /expression\s*\(|behavior\s*:|url\s*\(\s*javascript:/i.test(value)) {
        errors.push("Blocked unsafe inline CSS.");
      }
    }

    if (tagName === "meta") {
      const httpEquiv = attrs.find((a) => a.name.toLowerCase() === "http-equiv");
      if (httpEquiv && httpEquiv.value.trim().toLowerCase() === "refresh") {
        errors.push("Blocked meta refresh tag found.");
      }
    }

    if (tagName === "img") {
      const host = externalHost(attrs.find((a) => a.name.toLowerCase() === "src")?.value);
      if (host) hosts.add(host);
    }

    if (tagName === "title" && !title) title = collectText(node).trim().slice(0, 140) || null;
  };

  const stack: [Node, number][] = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (node.nodeType === Node.ELEMENT_NODE) visit(node as Element);
    if (depth >= MAX_DEPTH) {
      tooDeep = true;
      continue;
    }
    const children: Node[] = [...node.childNodes];
    if (walkTemplates && node instanceof HTMLTemplateElement) children.push(node.content);
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i]!, depth + 1]);
  }
  if (tooDeep) errors.push(`HTML is nested more than ${MAX_DEPTH} levels deep.`);

  return { ok: errors.length === 0, errors: [...new Set(errors)], hasScripts, title, hosts: [...hosts].toSorted() };
}
