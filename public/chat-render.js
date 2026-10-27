import { el } from "./dom.js";
import { safeUrl } from "./lib.js";
import { parseMarkdown } from "./markdown.js";

// Turns the markdown tree into DOM nodes. Everything goes through textContent / createTextNode, never innerHTML,
// so model output (which may repeat text from untrusted web pages) cannot inject markup.

const HEADING_TAG = { 1: "h3", 2: "h4", 3: "h5" };

function inline(nodes, sources) {
	return nodes.map((n) => {
		switch (n.type) {
			case "strong":
				return el("strong", {}, ...inline(n.children, sources));
			case "em":
				return el("em", {}, ...inline(n.children, sources));
			case "code":
				return el("code", { textContent: n.text });
			case "link":
				return el("a", { href: n.href, target: "_blank", rel: "noopener noreferrer" }, ...inline(n.children, sources));
			case "cite": {
				const source = sources[n.n - 1];
				return source
					? el("a", { className: "cite", href: safeUrl(source.url), target: "_blank", rel: "noopener noreferrer", title: `${source.headline} (${source.source})`, textContent: String(n.n) })
					: document.createTextNode(`[${n.n}]`);
			}
			default:
				return document.createTextNode(n.text);
		}
	});
}

function block(n, sources) {
	switch (n.type) {
		case "heading":
			return el(HEADING_TAG[n.level] ?? "h6", { className: "md-heading" }, ...inline(n.children, sources));
		case "code":
			return el("pre", {}, el("code", { textContent: n.text }));
		case "list":
			return el(
				n.ordered ? "ol" : "ul",
				n.ordered && n.start !== 1 ? { start: n.start } : {},
				...n.items.map((item) => el("li", {}, ...inline(item.children, sources), ...item.sublists.map((b) => block(b, sources)))),
			);
		case "blockquote":
			return el("blockquote", {}, ...n.children.map((b) => block(b, sources)));
		case "hr":
			return el("hr");
		case "table":
			return el(
				"div",
				{ className: "table-wrap" },
				el(
					"table",
					{},
					el("thead", {}, el("tr", {}, ...n.header.map((cell) => el("th", {}, ...inline(cell, sources))))),
					el("tbody", {}, ...n.rows.map((row) => el("tr", {}, ...row.map((cell) => el("td", {}, ...inline(cell, sources)))))),
				),
			);
		default:
			return el("p", {}, ...inline(n.children, sources));
	}
}

/** Render markdown text to DOM nodes. `sources` are the numbered articles from the stream's `meta` event. */
export function renderMarkdown(text, sources = []) {
	return parseMarkdown(text).map((n) => block(n, sources));
}

const TEXT_BLOCKS = new Set(["P", "H3", "H4", "H5", "H6", "PRE"]);
const CONTAINERS = new Set(["UL", "OL", "LI", "BLOCKQUOTE"]);

/** The deepest element that ends the text, so the blinking caret sits at the end of the last line. */
export function caretHost(root) {
	let node = root;
	for (;;) {
		const last = node.lastElementChild;
		if (!last) return node;
		if (last.tagName === "PRE") return last.lastElementChild ?? last;
		if (last.className === "table-wrap") return last.querySelector("tbody tr:last-child td:last-child") ?? last.querySelector("th:last-child") ?? node;
		if (TEXT_BLOCKS.has(last.tagName)) return last;
		if (CONTAINERS.has(last.tagName)) {
			node = last;
			continue;
		}
		return node;
	}
}
