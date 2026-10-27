// A small, safe Markdown parser for chat answers. It produces a plain data tree (never HTML), which chat.js turns into
// DOM nodes with textContent, so nothing in the model's output can inject markup or script.
//
// Block nodes:  paragraph, heading, code, list, blockquote, hr, table
// Inline nodes: text, strong, em, code, link (http/https only), cite ([n] source citations)
// It tolerates incomplete input, so it can be re-run on every streamed chunk.

import { safeHref } from "./lib.js";

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const indentOf = (line) => /^\s*/.exec(line)[0].length;
const isBlank = (line) => line.trim() === "";

export function parseMarkdown(src) {
	return parseBlocks(src.replace(/\r\n?/g, "\n").split("\n"));
}

function isTableStart(lines, i) {
	return lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && TABLE_SEP.test(lines[i + 1]);
}

function startsBlock(lines, i) {
	const line = lines[i];
	return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line) || isTableStart(lines, i);
}

function parseBlocks(lines) {
	const out = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (isBlank(line)) {
			i++;
			continue;
		}

		let m = FENCE.exec(line);
		if (m) {
			const [, fence, lang] = m;
			const closing = new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`);
			const body = [];
			i++;
			while (i < lines.length && !closing.test(lines[i])) body.push(lines[i++]);
			i++; // closing fence (or end of input while streaming)
			out.push({ type: "code", lang, text: body.join("\n") });
			continue;
		}

		if ((m = HEADING.exec(line))) {
			out.push({ type: "heading", level: m[1].length, children: parseInline(m[2].replace(/\s+#+\s*$/, "").trim()) });
			i++;
			continue;
		}

		if (HR.test(line)) {
			out.push({ type: "hr" });
			i++;
			continue;
		}

		if (QUOTE.test(line)) {
			const inner = [];
			while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
			out.push({ type: "blockquote", children: parseBlocks(inner) });
			continue;
		}

		if (isTableStart(lines, i)) {
			const header = splitRow(lines[i]).map(parseInline);
			i += 2;
			const rows = [];
			while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) rows.push(splitRow(lines[i++]).map(parseInline));
			out.push({ type: "table", header, rows });
			continue;
		}

		if (LIST.test(line)) {
			const [node, next] = parseList(lines, i);
			out.push(node);
			i = next;
			continue;
		}

		const para = [line.trim()];
		i++;
		while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) para.push(lines[i++].trim());
		out.push({ type: "paragraph", children: parseInline(para.join(" ")) });
	}
	return out;
}

function splitRow(line) {
	return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

function parseList(lines, start) {
	const first = LIST.exec(lines[start]);
	const baseIndent = first[1].length;
	const ordered = /\d/.test(first[2]);
	const node = { type: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };

	let i = start;
	while (i < lines.length) {
		const m = LIST.exec(lines[i]);
		if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;

		const text = [m[3].trim()];
		const nested = [];
		i++;
		while (i < lines.length) {
			const l = lines[i];
			if (isBlank(l)) {
				let j = i + 1;
				while (j < lines.length && isBlank(lines[j])) j++;
				if (j < lines.length && indentOf(lines[j]) > baseIndent) {
					i = j;
					continue;
				}
				break;
			}
			const indent = indentOf(l);
			if (indent <= baseIndent) break;
			if (LIST.test(l) || nested.length > 0) nested.push(l);
			else text.push(l.trim());
			i++;
		}

		const cut = nested.length ? Math.min(...nested.map(indentOf)) : 0;
		node.items.push({ children: parseInline(text.join(" ")), sublists: nested.length ? parseBlocks(nested.map((l) => l.slice(cut))) : [] });
	}
	return [node, i];
}

// --- Inline ----------------------------------------------------------------------------------------------------

const isWord = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch);
const isSpace = (ch) => ch === undefined || /\s/.test(ch);
const CITE = /^\[(\d{1,3})\](?!\()/;
const LINK = /^\[([^\]]+)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/;
const URL_AT = /^https?:\/\/[^\s<>]+/;

export function parseInline(text, { noLinks = false } = {}) {
	const out = [];
	let buf = "";
	const flush = () => {
		if (buf) out.push({ type: "text", text: buf });
		buf = "";
	};
	let i = 0;

	while (i < text.length) {
		const c = text[i];

		if (c === "`") {
			const end = text.indexOf("`", i + 1);
			if (end > i + 1) {
				flush();
				out.push({ type: "code", text: text.slice(i + 1, end) });
				i = end + 1;
				continue;
			}
		}

		if (c === "*" && text[i + 1] === "*" && !isSpace(text[i + 2])) {
			const end = text.indexOf("**", i + 2);
			if (end > i + 2) {
				flush();
				out.push({ type: "strong", children: parseInline(text.slice(i + 2, end), { noLinks }) });
				i = end + 2;
				continue;
			}
		}

		if (c === "*" && !isSpace(text[i + 1]) && text[i + 1] !== "*") {
			let end = text.indexOf("*", i + 1);
			while (end !== -1 && (isSpace(text[end - 1]) || text[end + 1] === "*")) end = text.indexOf("*", end + 1);
			if (end > i + 1) {
				flush();
				out.push({ type: "em", children: parseInline(text.slice(i + 1, end), { noLinks }) });
				i = end + 1;
				continue;
			}
		}

		if (c === "_" && !isWord(text[i - 1]) && !isSpace(text[i + 1]) && text[i + 1] !== "_") {
			let end = text.indexOf("_", i + 1);
			while (end !== -1 && (isSpace(text[end - 1]) || isWord(text[end + 1]))) end = text.indexOf("_", end + 1);
			if (end > i + 1) {
				flush();
				out.push({ type: "em", children: parseInline(text.slice(i + 1, end), { noLinks }) });
				i = end + 1;
				continue;
			}
		}

		if (c === "[") {
			const rest = text.slice(i);
			const link = LINK.exec(rest);
			if (link) {
				const href = safeHref(link[2]);
				flush();
				// An unsafe scheme (javascript:, data:, mailto:, ...) keeps the label but drops the target.
				if (href && !noLinks) out.push({ type: "link", href, children: parseInline(link[1], { noLinks: true }) });
				else out.push(...parseInline(link[1], { noLinks: true }));
				i += link[0].length;
				continue;
			}
			const cite = CITE.exec(rest);
			if (cite) {
				flush();
				out.push({ type: "cite", n: Number(cite[1]) });
				i += cite[0].length;
				continue;
			}
		}

		if (c === "h" && !noLinks && !isWord(text[i - 1])) {
			const url = URL_AT.exec(text.slice(i));
			if (url) {
				const clean = url[0].replace(/[.,;:!?)\]'"]+$/, "");
				const href = safeHref(clean);
				if (href) {
					flush();
					out.push({ type: "link", href, children: [{ type: "text", text: clean }] });
					i += clean.length;
					continue;
				}
			}
		}

		buf += c;
		i++;
	}
	flush();
	return out;
}
