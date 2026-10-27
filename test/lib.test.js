import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPICS, buildQuery, groupByTopic, scoreClass, lastRefreshed, formatDate, safeUrl, timeAgo } from "../public/lib.js";

const art = (over) => ({ id: 1, topic: TOPICS[0].label, headline: "h", source: "s", published_at: "2026-10-25", url: "https://x.test/1", summary: "sum", relevance_score: 7, fetched_at: "2026-10-26T20:00:00Z", ...over });

test("buildQuery includes only set filters", () => {
	assert.equal(buildQuery({ topic: "", minScore: "", limit: 50 }), "limit=50");
	assert.equal(buildQuery({ topic: "healthcare-ai", minScore: "6", limit: 25 }), "topic=healthcare-ai&min_score=6&limit=25");
	assert.equal(buildQuery({ topic: "", minScore: "0", limit: 10 }), "limit=10");
});

test("groupByTopic orders groups by TOPICS, keeps article order, drops empty groups", () => {
	const a = art({ id: 1, topic: TOPICS[2].label });
	const b = art({ id: 2, topic: TOPICS[0].label });
	const c = art({ id: 3, topic: TOPICS[0].label });
	const groups = groupByTopic([a, b, c]);
	assert.deepEqual(groups.map((g) => g.label), [TOPICS[0].label, TOPICS[2].label]);
	assert.deepEqual(groups[0].articles.map((x) => x.id), [2, 3]);
});

test("groupByTopic appends unknown topics at the end", () => {
	const groups = groupByTopic([art({ topic: "something new" }), art({ topic: TOPICS[1].label })]);
	assert.deepEqual(groups.map((g) => g.label), [TOPICS[1].label, "something new"]);
});

test("scoreClass buckets scores", () => {
	assert.equal(scoreClass(10), "high");
	assert.equal(scoreClass(8), "high");
	assert.equal(scoreClass(7), "mid");
	assert.equal(scoreClass(5), "mid");
	assert.equal(scoreClass(4), "low");
	assert.equal(scoreClass(1), "low");
	assert.equal(scoreClass(null), "none");
});

test("lastRefreshed returns the newest fetched_at, or null", () => {
	assert.equal(lastRefreshed([art({ fetched_at: "2026-10-25T10:00:00Z" }), art({ fetched_at: "2026-10-26T20:00:00Z" })]).toISOString(), "2026-10-26T20:00:00.000Z");
	assert.equal(lastRefreshed([]), null);
});

test("formatDate renders YYYY-MM-DD without timezone shifting", () => {
	assert.equal(formatDate("2026-10-25"), "Oct 25, 2026");
	assert.equal(formatDate("2026-01-01"), "Jan 1, 2026");
	assert.equal(formatDate("garbage"), "garbage");
});

test("safeUrl only allows http(s)", () => {
	assert.equal(safeUrl("https://a.test/x"), "https://a.test/x");
	assert.equal(safeUrl("javascript:alert(1)"), "#");
	assert.equal(safeUrl("not a url"), "#");
});

test("timeAgo", () => {
	const now = new Date("2026-10-26T12:00:00Z");
	assert.equal(timeAgo(new Date("2026-10-26T11:59:40Z"), now), "just now");
	assert.equal(timeAgo(new Date("2026-10-26T11:30:00Z"), now), "30 minutes ago");
	assert.equal(timeAgo(new Date("2026-10-26T11:00:00Z"), now), "1 hour ago");
	assert.equal(timeAgo(new Date("2026-10-25T09:00:00Z"), now), "1 day ago");
});

import { authHeaders } from "../public/lib.js";

test("authHeaders sends the password as a Bearer token, trimmed", () => {
	assert.deepEqual(authHeaders("s3cret"), { Authorization: "Bearer s3cret" });
	assert.deepEqual(authHeaders("  s3cret \n"), { Authorization: "Bearer s3cret" });
});

test("authHeaders sends nothing for an empty password", () => {
	assert.deepEqual(authHeaders(""), {});
	assert.deepEqual(authHeaders("   "), {});
	assert.deepEqual(authHeaders(null), {});
});

import { CHAT_MODELS, buildHistory, chatErrorMessage, formatUsage, modelLabel } from "../public/lib.js";

test("chat model choices offer a fast and a capable option, capable by default", () => {
	assert.deepEqual(CHAT_MODELS.map((m) => m.alias), ["haiku", "sonnet"]);
	assert.match(CHAT_MODELS[0].label, /fast/i);
	assert.match(CHAT_MODELS[1].label, /capable/i);
});

test("formatUsage shows input, output and total tokens with separators", () => {
	assert.equal(formatUsage({ input_tokens: 3169, output_tokens: 563 }), "3,169 in · 563 out · 3,732 total tokens");
	assert.equal(formatUsage(undefined), "");
	assert.equal(formatUsage({ input_tokens: 0, output_tokens: 0 }), "0 in · 0 out · 0 total tokens");
});

test("modelLabel prettifies Claude model ids", () => {
	assert.equal(modelLabel("claude-sonnet-5-5"), "Sonnet 5.5");
	assert.equal(modelLabel("claude-haiku-5-5"), "Haiku 5.5");
	assert.equal(modelLabel("claude-opus-5"), "Opus 5");
	assert.equal(modelLabel("something-else"), "something-else");
});

test("buildHistory keeps the latest turns, starts with a user message, and truncates long text", () => {
	const turns = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
	const h = buildHistory(turns);
	assert.ok(h.length <= 10);
	assert.equal(h[0].role, "user");
	assert.equal(h.at(-1).content, "m13");
	assert.equal(buildHistory([{ role: "user", content: "x".repeat(5000) }])[0].content.length, 4000);
	assert.deepEqual(buildHistory([]), []);
	assert.deepEqual(buildHistory([{ role: "assistant", content: "orphan" }]), []);
});

test("chatErrorMessage gives friendly text per status", () => {
	assert.match(chatErrorMessage(401), /password/i);
	assert.equal(chatErrorMessage(429, "The model is rate limited right now."), "The model is rate limited right now.");
	assert.match(chatErrorMessage(429), /busy|rate/i);
	assert.match(chatErrorMessage(502), /unavailable|failed|try again/i);
	assert.equal(chatErrorMessage(400, "question is required"), "question is required");
	assert.match(chatErrorMessage(0), /network|connection/i);
});
