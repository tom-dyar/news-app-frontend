import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSse } from "../public/sse.js";

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test("parses complete events and returns no remainder", () => {
	const { events, rest } = parseSse(frame("meta", { a: 1 }) + frame("delta", { text: "hi" }));
	assert.deepEqual(events, [{ event: "meta", data: { a: 1 } }, { event: "delta", data: { text: "hi" } }]);
	assert.equal(rest, "");
});

test("keeps an incomplete trailing event as the remainder", () => {
	const full = frame("delta", { text: "abc" });
	const { events, rest } = parseSse(frame("meta", {}) + full.slice(0, 20));
	assert.equal(events.length, 1);
	assert.equal(rest, full.slice(0, 20));
	assert.deepEqual(parseSse(rest + full.slice(20)).events, [{ event: "delta", data: { text: "abc" } }]);
});

test("reassembles correctly when the stream is split at every possible byte boundary", () => {
	const text = frame("meta", { sources: [1, 2] }) + frame("delta", { text: "line1\nline2 \"q\" é" }) + frame("done", { usage: { input_tokens: 5 } });
	for (let cut = 0; cut <= text.length; cut++) {
		let buffer = "";
		const seen = [];
		for (const chunk of [text.slice(0, cut), text.slice(cut)]) {
			const r = parseSse(buffer + chunk);
			buffer = r.rest;
			seen.push(...r.events);
		}
		assert.deepEqual(seen.map((e) => e.event), ["meta", "delta", "done"], `cut ${cut}`);
		assert.equal(seen[1].data.text, "line1\nline2 \"q\" é");
	}
});

test("accepts CRLF line endings and ignores malformed or comment-only frames", () => {
	const { events } = parseSse(': ping\n\nevent: delta\r\ndata: {"text":"x"}\r\n\r\nevent: bad\ndata: {nope\n\n');
	assert.deepEqual(events, [{ event: "delta", data: { text: "x" } }]);
});
