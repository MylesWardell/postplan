//! Differential candidate: html5ever tree construction + the production
//! Postplan HTML policy walk, compiled to wasm32-unknown-unknown.
//! JS-only semantics (title trim/slice, URL host parsing) stay in the glue.

use std::borrow::Cow;
use std::cell::{Cell, RefCell};

use html5ever::interface::{ElemName, ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::tendril::{StrTendril, TendrilSink};
use html5ever::tree_builder::TreeBuilderOpts;
use html5ever::{parse_document, Attribute, LocalName, Namespace, ParseOpts, QualName};

const MAX_DEPTH: usize = 512;

enum Kind {
    Document,
    Fragment,
    Doctype,
    Comment,
    Text(StrTendril),
    Element {
        name: QualName,
        attrs: Vec<Attribute>,
        template: Option<usize>,
        mathml_ip: bool,
    },
}

struct Node {
    kind: Kind,
    parent: Option<usize>,
    children: Vec<usize>,
}

pub struct Sink {
    nodes: RefCell<Vec<Node>>,
    dsd: Cell<bool>,
}

#[derive(Debug)]
pub struct Name {
    ns: Namespace,
    local: LocalName,
}

impl ElemName for Name {
    fn ns(&self) -> &Namespace {
        &self.ns
    }
    fn local_name(&self) -> &LocalName {
        &self.local
    }
}

impl Sink {
    fn new(dsd: bool) -> Self {
        let nodes = vec![Node { kind: Kind::Document, parent: None, children: Vec::new() }];
        Sink { nodes: RefCell::new(nodes), dsd: Cell::new(dsd) }
    }

    fn push(&self, kind: Kind) -> usize {
        let mut nodes = self.nodes.borrow_mut();
        nodes.push(Node { kind, parent: None, children: Vec::new() });
        nodes.len() - 1
    }

    fn detach(nodes: &mut [Node], child: usize) {
        if let Some(parent) = nodes[child].parent.take() {
            let siblings = &mut nodes[parent].children;
            if let Some(i) = siblings.iter().rposition(|&c| c == child) {
                siblings.remove(i);
            }
        }
    }
}

impl TreeSink for Sink {
    type Handle = usize;
    type Output = Self;
    type ElemName<'a> = Name;

    fn finish(self) -> Self {
        self
    }

    fn parse_error(&self, _msg: Cow<'static, str>) {}

    fn get_document(&self) -> usize {
        0
    }

    fn elem_name<'a>(&'a self, target: &'a usize) -> Name {
        match &self.nodes.borrow()[*target].kind {
            Kind::Element { name, .. } => Name { ns: name.ns.clone(), local: name.local.clone() },
            _ => panic!("not an element"),
        }
    }

    fn create_element(&self, name: QualName, attrs: Vec<Attribute>, flags: ElementFlags) -> usize {
        let template = if flags.template { Some(self.push(Kind::Fragment)) } else { None };
        self.push(Kind::Element {
            name,
            attrs,
            template,
            mathml_ip: flags.mathml_annotation_xml_integration_point,
        })
    }

    fn create_comment(&self, _text: StrTendril) -> usize {
        self.push(Kind::Comment)
    }

    fn create_pi(&self, _target: StrTendril, _data: StrTendril) -> usize {
        self.push(Kind::Comment)
    }

    fn append(&self, parent: &usize, child: NodeOrText<usize>) {
        let mut nodes = self.nodes.borrow_mut();
        match child {
            NodeOrText::AppendText(text) => {
                if let Some(&last) = nodes[*parent].children.last() {
                    if let Kind::Text(existing) = &mut nodes[last].kind {
                        existing.push_tendril(&text);
                        return;
                    }
                }
                nodes.push(Node { kind: Kind::Text(text), parent: Some(*parent), children: Vec::new() });
                let id = nodes.len() - 1;
                nodes[*parent].children.push(id);
            }
            NodeOrText::AppendNode(node) => {
                Self::detach(&mut nodes, node);
                nodes[node].parent = Some(*parent);
                nodes[*parent].children.push(node);
            }
        }
    }

    fn append_based_on_parent_node(&self, element: &usize, prev: &usize, child: NodeOrText<usize>) {
        let has_parent = self.nodes.borrow()[*element].parent.is_some();
        if has_parent {
            self.append_before_sibling(element, child);
        } else {
            self.append(prev, child);
        }
    }

    fn append_doctype_to_document(&self, _n: StrTendril, _p: StrTendril, _s: StrTendril) {
        let id = self.push(Kind::Doctype);
        let mut nodes = self.nodes.borrow_mut();
        nodes[id].parent = Some(0);
        nodes[0].children.push(id);
    }

    fn get_template_contents(&self, target: &usize) -> usize {
        match &self.nodes.borrow()[*target].kind {
            Kind::Element { template: Some(t), .. } => *t,
            _ => panic!("not a template"),
        }
    }

    fn same_node(&self, x: &usize, y: &usize) -> bool {
        x == y
    }

    fn set_quirks_mode(&self, _mode: QuirksMode) {}

    fn append_before_sibling(&self, sibling: &usize, child: NodeOrText<usize>) {
        let mut nodes = self.nodes.borrow_mut();
        let parent = nodes[*sibling].parent.expect("sibling has parent");
        match child {
            NodeOrText::AppendText(text) => {
                let index = nodes[parent].children.iter().position(|c| c == sibling).unwrap();
                if index > 0 {
                    let prev = nodes[parent].children[index - 1];
                    if let Kind::Text(existing) = &mut nodes[prev].kind {
                        existing.push_tendril(&text);
                        return;
                    }
                }
                nodes.push(Node { kind: Kind::Text(text), parent: Some(parent), children: Vec::new() });
                let id = nodes.len() - 1;
                nodes[parent].children.insert(index, id);
            }
            NodeOrText::AppendNode(node) => {
                Self::detach(&mut nodes, node);
                let index = nodes[parent].children.iter().position(|c| c == sibling).unwrap();
                nodes[node].parent = Some(parent);
                nodes[parent].children.insert(index, node);
            }
        }
    }

    fn add_attrs_if_missing(&self, target: &usize, new_attrs: Vec<Attribute>) {
        let mut nodes = self.nodes.borrow_mut();
        if let Kind::Element { attrs, .. } = &mut nodes[*target].kind {
            for attr in new_attrs {
                if !attrs.iter().any(|a| a.name == attr.name) {
                    attrs.push(attr);
                }
            }
        }
    }

    fn remove_from_parent(&self, target: &usize) {
        Self::detach(&mut self.nodes.borrow_mut(), *target);
    }

    fn reparent_children(&self, node: &usize, new_parent: &usize) {
        let mut nodes = self.nodes.borrow_mut();
        let children = std::mem::take(&mut nodes[*node].children);
        for &child in &children {
            nodes[child].parent = Some(*new_parent);
        }
        nodes[*new_parent].children.extend(children);
    }

    fn is_mathml_annotation_xml_integration_point(&self, handle: &usize) -> bool {
        matches!(self.nodes.borrow()[*handle].kind, Kind::Element { mathml_ip: true, .. })
    }

    fn allow_declarative_shadow_roots(&self, _intended_parent: &usize) -> bool {
        self.dsd.get()
    }
}

/// ECMAScript WhiteSpace + LineTerminator (String.prototype.trim and \s).
fn js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'
            | '\u{a}'
            | '\u{b}'
            | '\u{c}'
            | '\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(js_space)
}

fn lower(s: &str) -> String {
    s.to_lowercase()
}

/// /expression\s*\(|behavior\s*:|url\s*\(\s*javascript:/i (non-unicode /i:
/// only ASCII letters fold).
fn unsafe_css(value: &str) -> bool {
    let chars: Vec<char> = value.chars().collect();
    let word = |at: usize, w: &str| -> Option<usize> {
        let mut i = at;
        for wc in w.chars() {
            let c = *chars.get(i)?;
            if c.to_ascii_lowercase() != wc {
                return None;
            }
            i += 1;
        }
        Some(i)
    };
    let spaces = |mut i: usize| {
        while i < chars.len() && js_space(chars[i]) {
            i += 1;
        }
        i
    };
    let lit = |i: usize, c: char| chars.get(i) == Some(&c);
    for start in 0..chars.len() {
        if let Some(i) = word(start, "expression") {
            if lit(spaces(i), '(') {
                return true;
            }
        }
        if let Some(i) = word(start, "behavior") {
            if lit(spaces(i), ':') {
                return true;
            }
        }
        if let Some(i) = word(start, "url") {
            let i = spaces(i);
            if lit(i, '(') && word(spaces(i + 1), "javascript:").is_some() {
                return true;
            }
        }
    }
    false
}

fn blocked_url(value: &str) -> bool {
    let stripped: String = js_trim(value).chars().filter(|&c| c > '\u{20}').take(16).collect();
    let normalized = lower(&stripped);
    ["javascript:", "vbscript:", "file:"].iter().any(|p| normalized.starts_with(p))
}

pub struct Outcome {
    pub errors: Vec<String>,
    pub title: Option<String>,
    pub has_scripts: bool,
    pub img_srcs: Vec<String>,
}

fn push_unique(list: &mut Vec<String>, value: String) {
    if !list.iter().any(|v| *v == value) {
        list.push(value);
    }
}

pub fn run(html: &str, dsd: bool, walk_templates: bool) -> Outcome {
    let opts = ParseOpts {
        tree_builder: TreeBuilderOpts { scripting_enabled: false, ..Default::default() },
        ..Default::default()
    };
    let sink = parse_document(Sink::new(dsd), opts).one(StrTendril::from_slice(html));
    let nodes = sink.nodes.into_inner();

    let mut errors: Vec<String> = Vec::new();
    let mut title: Option<String> = None;
    let mut title_seen = false;
    let mut has_scripts = false;
    let mut img_srcs: Vec<String> = Vec::new();
    let mut too_deep = false;

    let mut stack: Vec<(usize, usize)> = vec![(0, 0)];
    while let Some((id, depth)) = stack.pop() {
        let node = &nodes[id];
        if let Kind::Element { name, attrs, .. } = &node.kind {
            let tag = lower(&name.local);
            if matches!(tag.as_str(), "form" | "iframe" | "object" | "embed" | "applet" | "base" | "link") {
                push_unique(&mut errors, format!("Blocked <{tag}> tag found."));
            }
            if tag == "script" {
                has_scripts = true;
                let mut has_src = false;
                let mut script_type = String::new();
                for attr in attrs {
                    let n = lower(&attr.name.local);
                    if n == "src" {
                        has_src = true;
                    } else if n == "type" {
                        script_type = js_trim(&attr.value).to_string();
                    }
                }
                if has_src {
                    push_unique(&mut errors, "External script sources are not allowed.".into());
                }
                let script_type = lower(&script_type);
                if !matches!(script_type.as_str(), "" | "text/javascript" | "application/javascript") {
                    push_unique(&mut errors, format!("Unsupported script type \"{script_type}\" found."));
                }
            }
            for attr in attrs {
                let n = lower(&attr.name.local);
                if n.starts_with("on") {
                    push_unique(&mut errors, format!("Blocked inline event handler attribute \"{n}\" found."));
                }
                if n == "srcdoc" {
                    push_unique(&mut errors, "Blocked \"srcdoc\" attribute found.".into());
                }
                if matches!(n.as_str(), "href" | "src" | "action" | "formaction" | "poster" | "srcdoc" | "xlink:href")
                    && blocked_url(&attr.value)
                {
                    push_unique(&mut errors, format!("Blocked unsafe URL in \"{n}\" attribute."));
                }
                if n == "style" && unsafe_css(js_trim(&attr.value)) {
                    push_unique(&mut errors, "Blocked unsafe inline CSS.".into());
                }
            }
            if tag == "meta" {
                if let Some(attr) = attrs.iter().find(|a| lower(&a.name.local) == "http-equiv") {
                    if lower(js_trim(&attr.value)) == "refresh" {
                        push_unique(&mut errors, "Blocked meta refresh tag found.".into());
                    }
                }
            }
            if tag == "img" {
                if let Some(attr) = attrs.iter().find(|a| lower(&a.name.local) == "src") {
                    push_unique(&mut img_srcs, attr.value.to_string());
                }
            }
            if !title_seen && &*name.local == "title" {
                let mut text = String::new();
                let mut pending: Vec<usize> = node.children.iter().rev().copied().collect();
                while let Some(child) = pending.pop() {
                    if let Kind::Text(t) = &nodes[child].kind {
                        text.push_str(t);
                    }
                    pending.extend(nodes[child].children.iter().rev());
                }
                // JS keeps looking while the trimmed title is empty.
                if !js_trim(&text).is_empty() {
                    title_seen = true;
                    title = Some(text);
                }
            }
        }
        if depth >= MAX_DEPTH {
            too_deep = true;
            continue;
        }
        if walk_templates {
            if let Kind::Element { template: Some(t), .. } = &node.kind {
                stack.push((*t, depth + 1));
            }
        }
        for &child in node.children.iter().rev() {
            stack.push((child, depth + 1));
        }
    }
    if too_deep {
        push_unique(&mut errors, format!("HTML is nested more than {MAX_DEPTH} levels deep."));
    }
    Outcome { errors, title, has_scripts, img_srcs }
}

// ---- wasm ABI -------------------------------------------------------------

static mut OUT: Vec<u8> = Vec::new();

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) };
}

/// Output: `[total u32 LE]` then records `[tag u8][len u32 LE][utf8]`;
/// tags E=error, T=title text, I=img src, S=has scripts.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn validate(ptr: *const u8, len: usize, dsd: u32) -> *const u8 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let html = std::str::from_utf8(bytes).expect("utf8");
    let outcome = run(html, dsd & 1 != 0, dsd & 2 != 0);
    #[allow(static_mut_refs)]
    let out = unsafe { &mut OUT };
    out.clear();
    out.extend_from_slice(&[0; 4]);
    let mut record = |tag: u8, s: &str| {
        out.push(tag);
        out.extend_from_slice(&(s.len() as u32).to_le_bytes());
        out.extend_from_slice(s.as_bytes());
    };
    for e in &outcome.errors {
        record(b'E', e);
    }
    if let Some(t) = &outcome.title {
        record(b'T', t);
    }
    for s in &outcome.img_srcs {
        record(b'I', s);
    }
    if outcome.has_scripts {
        record(b'S', "");
    }
    let total = (out.len() - 4) as u32;
    out[..4].copy_from_slice(&total.to_le_bytes());
    out.as_ptr()
}
