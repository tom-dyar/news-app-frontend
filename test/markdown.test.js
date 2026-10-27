import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../public/markdown.js";

const t = (text) => ({ type: "text", text });
const para = (...children) => ({ type: "paragraph", children });

test("paragraphs split on blank lines and join soft line breaks with a space", () => {
	assert.deepEqual(parseMarkdown("one\ntwo\n\nthree"), [para(t("one two")), para(t("three"))]);
	assert.deepEqual(parseMarkdown(""), []);
	assert.deepEqual(parseMarkdown("\n\n  \n"), []);
});

test("headings", () => {
	assert.deepEqual(parseMarkdown("## Title here"), [{ type: "heading", level: 2, children: [t("Title here")] }]);
	assert.deepEqual(parseMarkdown("####### seven")[0].type, "paragraph");
});

test("bold, italic and inline code", () => {
	assert.deepEqual(parseMarkdown("a **bold** and *it* and _it2_ and `x < y`"), [
		para(t("a "), { type: "strong", children: [t("bold")] }, t(" and "), { type: "em", children: [t("it")] }, t(" and "), { type: "em", children: [t("it2")] }, t(" and "), { type: "code", text: "x < y" }),
	]);
});

test("nested emphasis inside bold", () => {
	assert.deepEqual(parseMarkdown("**a *b* c**"), [para({ type: "strong", children: [t("a "), { type: "em", children: [t("b")] }, t(" c")] })]);
});

test("underscores inside words and unmatched markers stay literal", () => {
	assert.deepEqual(parseMarkdown("use snake_case_name here"), [para(t("use snake_case_name here"))]);
	assert.deepEqual(parseMarkdown("2 * 3 = 6"), [para(t("2 * 3 = 6"))]);
	assert.deepEqual(parseMarkdown("an **unclosed bold"), [para(t("an **unclosed bold"))]);
	assert.deepEqual(parseMarkdown("a ` lonely tick"), [para(t("a ` lonely tick"))]);
});

test("links are kept only for http(s); other schemes degrade to plain text", () => {
	assert.deepEqual(parseMarkdown("[site](https://a.test/x?y=1)"), [para({ type: "link", href: "https://a.test/x?y=1", children: [t("site")] })]);
	const bad = JSON.stringify(parseMarkdown("[click](javascript:alert(1)) and [d](data:text/html,x) and [m](mailto:a@b.c)"));
	assert.ok(!bad.includes('"link"'), "no link node for unsafe schemes");
	assert.ok(bad.includes("click"));
});

test("bare URLs become links without trailing punctuation", () => {
	assert.deepEqual(parseMarkdown("see https://a.test/p."), [para(t("see "), { type: "link", href: "https://a.test/p", children: [t("https://a.test/p")] }, t("."))]);
});

test("citation markers [n] become cite nodes, including adjacent ones; [text](url) is not a citation", () => {
	assert.deepEqual(parseMarkdown("Claim [1][23]."), [para(t("Claim "), { type: "cite", n: 1 }, { type: "cite", n: 23 }, t("."))]);
	assert.deepEqual(parseMarkdown("[1](https://a.test)")[0].children[0].type, "link");
});

test("raw HTML is never interpreted: it stays text", () => {
	const ast = parseMarkdown("<script>alert(1)</script> <b>x</b> <img src=x onerror=y>");
	assert.deepEqual(ast, [para(t("<script>alert(1)</script> <b>x</b> <img src=x onerror=y>"))]);
});

test("unordered, ordered and nested lists", () => {
	assert.deepEqual(parseMarkdown("- a\n- b"), [{ type: "list", ordered: false, start: 1, items: [{ children: [t("a")], sublists: [] }, { children: [t("b")], sublists: [] }] }]);
	const ol = parseMarkdown("3. x\n4. y")[0];
	assert.equal(ol.ordered, true);
	assert.equal(ol.start, 3);
	const nested = parseMarkdown("- a\n  - a1\n  - a2\n- b")[0];
	assert.equal(nested.items.length, 2);
	assert.equal(nested.items[0].sublists[0].items.length, 2);
	assert.deepEqual(nested.items[0].sublists[0].items[1].children, [t("a2")]);
});

test("list item continuation lines are folded into the item", () => {
	assert.deepEqual(parseMarkdown("- first line\n  more of it\n- second")[0].items[0].children, [t("first line more of it")]);
});

test("a list directly after a paragraph line starts a new block", () => {
	const ast = parseMarkdown("Intro:\n- a\n- b");
	assert.equal(ast[0].type, "paragraph");
	assert.equal(ast[1].type, "list");
});

test("fenced code blocks keep their text verbatim, even unclosed (streaming)", () => {
	assert.deepEqual(parseMarkdown("```js\nconst a = **1**;\n```"), [{ type: "code", lang: "js", text: "const a = **1**;" }]);
	assert.deepEqual(parseMarkdown("```\nstill typing"), [{ type: "code", lang: "", text: "still typing" }]);
});

test("blockquotes contain blocks", () => {
	assert.deepEqual(parseMarkdown("> quoted **x**"), [{ type: "blockquote", children: [para(t("quoted "), { type: "strong", children: [t("x")] })] }]);
});

test("horizontal rules", () => {
	assert.deepEqual(parseMarkdown("a\n\n---\n\nb").map((n) => n.type), ["paragraph", "hr", "paragraph"]);
});

test("tables", () => {
	const ast = parseMarkdown("| Name | Score |\n| --- | ---: |\n| Alpha | **9** |\n| Beta | 7 |");
	assert.equal(ast[0].type, "table");
	assert.deepEqual(ast[0].header, [[t("Name")], [t("Score")]]);
	assert.equal(ast[0].rows.length, 2);
	assert.deepEqual(ast[0].rows[0][1], [{ type: "strong", children: [t("9")] }]);
});

test("every prefix of a realistic answer parses without throwing (streaming)", () => {
	const doc = "**What happened**\n\n- UNM detected a breach [1].\n  - Sub point `code`\n1. First [2][3]\n\n> note\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```py\nprint(1)\n```\n\nSee [link](https://a.test) and https://b.test.\n";
	for (let i = 0; i <= doc.length; i++) assert.doesNotThrow(() => parseMarkdown(doc.slice(0, i)), `prefix ${i}`);
});
