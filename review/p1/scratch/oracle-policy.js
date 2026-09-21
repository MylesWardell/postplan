// Chrome-side ground truth: the production policy applied to the real DOM.
// Injected into a browser tab with preview_evaluate; INPUTS is replaced with a
// JSON array of documents. Returns one compact digest per input so results can
// be compared with the parse5 and html5ever runs locally.
//
// Differences from packages/store/src/html-policy.ts, all deliberate:
//   - walks shadow roots and <template>.content, which the DOM exposes and the
//     browser renders, so the oracle reports what a viewer would actually see;
//   - no byte-length or empty-input checks (those are pre-parse policy).
(() => {
  const BLOCKED_TAGS = new Set(["form", "iframe", "object", "embed", "applet", "base", "link"]);
  const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "srcdoc", "xlink:href"]);
  const BLOCKED_PROTOCOLS = ["javascript:", "vbscript:", "file:"];
  const ALLOWED_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript"]);
  const MAX_DEPTH = 512;
  const CONTROL_OR_SPACE = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(32)}]+`, "g");

  const externalHost = (value) => {
    const raw = (value || "").trim();
    if (!raw) return null;
    try {
      const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      if (url.protocol === "http:" || url.protocol === "https:") return url.hostname.toLowerCase();
    } catch {}
    return null;
  };

  const collectText = (node) => {
    let value = "";
    for (const child of node.childNodes) {
      if (child.nodeType === 3) value += child.data;
      if (child.nodeType === 1) value += collectText(child);
    }
    return value;
  };

  const policy = (root) => {
    const errors = [];
    const hosts = new Set();
    let title = null;
    let hasScripts = false;
    let tooDeep = false;

    const visit = (node) => {
      const tagName = node.localName.toLowerCase();
      if (BLOCKED_TAGS.has(tagName)) errors.push(`Blocked <${tagName}> tag found.`);

      if (tagName === "script") {
        hasScripts = true;
        const attributes = new Map(
          [...node.attributes].map((a) => [a.name.toLowerCase(), (a.value || "").trim()]),
        );
        if (attributes.has("src")) errors.push("External script sources are not allowed.");
        const scriptType = (attributes.get("type") || "").toLowerCase();
        if (!ALLOWED_SCRIPT_TYPES.has(scriptType)) {
          errors.push(`Unsupported script type "${scriptType}" found.`);
        }
      }

      for (const attr of node.attributes) {
        const name = attr.name.toLowerCase();
        const value = (attr.value || "").trim();
        if (name.startsWith("on")) errors.push(`Blocked inline event handler attribute "${name}" found.`);
        if (name === "srcdoc") errors.push('Blocked "srcdoc" attribute found.');
        if (URL_ATTRS.has(name)) {
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
        const httpEquiv = [...node.attributes].find((a) => a.name.toLowerCase() === "http-equiv");
        if (httpEquiv && httpEquiv.value.trim().toLowerCase() === "refresh") {
          errors.push("Blocked meta refresh tag found.");
        }
      }

      if (tagName === "img") {
        const src = [...node.attributes].find((a) => a.name.toLowerCase() === "src");
        const host = externalHost(src?.value);
        if (host) hosts.add(host);
      }

      if (tagName === "title" && !title) title = collectText(node).trim().slice(0, 140) || null;
    };

    const stack = [[root, 0]];
    while (stack.length) {
      const [node, depth] = stack.pop();
      if (node.nodeType === 1) visit(node);
      if (depth >= MAX_DEPTH) {
        tooDeep = true;
        continue;
      }
      const children = [...node.childNodes];
      if (node.nodeType === 1) {
        if (node.shadowRoot) children.push(node.shadowRoot);
        if (node.content) children.push(node.content);
      }
      for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1]);
    }
    if (tooDeep) errors.push(`HTML is nested more than ${MAX_DEPTH} levels deep.`);

    const unique = [...new Set(errors)];
    return {
      ok: unique.length === 0,
      errors: unique,
      hasScripts,
      title,
      hosts: [...hosts].toSorted(),
    };
  };

  const digest = (r) =>
    `${r.ok ? 1 : 0}|${r.hasScripts ? 1 : 0}|${JSON.stringify(r.title)}|${r.hosts.join(",")}|${[...r.errors].toSorted().join("~")}`;

  return INPUTS.map((html) => {
    try {
      return digest(policy(Document.parseHTMLUnsafe(html)));
    } catch (error) {
      return `threw:${String(error).slice(0, 60)}`;
    }
  });
})()
